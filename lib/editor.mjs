/**
 * Full-screen alternate-buffer editor.
 *
 * One preferences object drives the live preview through the same renderLine
 * the installed command uses. Keys are read in raw mode. Cleanup always
 * restores the main buffer, the cursor, and cooked input, including signals
 * and a failed draw.
 */

import { emitKeypressEvents } from "node:readline";
import { padVisible, sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
import { editorStrings, segmentText } from "./editor-i18n.mjs";
import { COLOR_DEPTHS, ICON_SETS, PRESETS, SEGMENT_REGISTRY, SKINS, THEMES, normalizePreferences } from "./preferences.mjs";
import { renderLine } from "./render.mjs";
import { SAMPLE_GIT, samplePayload } from "./sample.mjs";
import { collectSegments } from "./segments.mjs";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";
const RESET = "\x1b[0m";

const FIELDS = ["preset", "theme", "skin", "icons", "colorDepth", "segments"];
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "简体中文" },
];

export async function selectLanguage({ stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) return null;
  return new Promise((resolve, reject) => {
    let selected = 0;
    const finish = (value) => {
      close();
      resolve(value);
    };
    const draw = () => {
      const columns = stdout.columns || 80;
      const rows = stdout.rows || 24;
      const options = LANGUAGES.map(({ label }, index) => `${index === selected ? ">" : " "} ${index + 1}. ${label}`);
      const lines = [];
      if (rows > 2) lines.push(title("Language / 选择语言"));
      if (rows > 3) lines.push("");
      lines.push(...(rows > 1 ? options : [options[selected]]));
      if (rows > 4) lines.push(dim("Enter · Esc · ↑/↓ · Tab · 1–2"));
      stdout.write(CLEAR + lines.map((line) => clip(line, columns)).join("\n"));
    };
    const close = openTerminal(stdin, stdout, draw, (text, key) => {
      const action = keyAction(text, key);
      if (action === "cancel") return finish(null);
      if (action === "save") return finish(LANGUAGES[selected].code);
      if (text === "1" || text === "2") selected = Number(text) - 1;
      else if (key?.name === "tab" || ["up", "down", "left", "right"].includes(action)) {
        selected = 1 - selected;
      } else return;
      try {
        draw();
      } catch (error) {
        close();
        reject(error);
      }
    }, () => finish(null), reject);
  });
}

export async function confirmReplace({ stdin = process.stdin, stdout = process.stdout, command = "", language = "en" } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const strings = editorStrings(language);
  return new Promise((resolve, reject) => {
    const finish = (value) => {
      close();
      resolve(value);
    };
    const draw = () => {
      const columns = stdout.columns || 80;
      const rows = stdout.rows || 24;
      const shown = command ? sanitizeText(command) : strings.emptyCommand;
      const lines = [];
      if (rows >= 2) lines.push(title(strings.replaceTitle));
      if (rows >= 6) lines.push("", `  ${shown}`, "");
      else if (rows >= 4) lines.push(`  ${shown}`);
      if (rows >= 3) lines.push(strings.replaceYes, strings.replaceNo);
      else lines.push(strings.replaceKeys);
      stdout.write(CLEAR + lines.map((line) => clip(line, columns)).join("\n"));
    };
    const close = openTerminal(stdin, stdout, draw, (text, key) => {
      if (text?.toLowerCase() === "y") finish(true);
      else if (text?.toLowerCase() === "n" || keyAction(text, key) === "cancel") finish(false);
    }, () => finish(false), reject);
  });
}

export async function runEditor({ preferences, stdin = process.stdin, stdout = process.stdout, onSave, language = "en" }) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(editorStrings(language).needsTTY);
  }
  const session = new Session(normalizePreferences(preferences), { stdin, stdout, onSave, language });
  return session.run();
}

class Session {
  constructor(preferences, { stdin, stdout, onSave, language }) {
    this.preferences = preferences;
    this.stdin = stdin;
    this.stdout = stdout;
    this.onSave = onSave;
    this.language = language;
    this.strings = editorStrings(language);
    this.field = 0;
    this.segment = 0;
    this.closed = false;
    this.busy = false;
    this.interrupted = false;
    this.help = false;
    this.error = "";
    this.onKeypress = (text, key) => this.handle(keyAction(text, key)).catch((error) => {
      this.closed = true;
      this.close();
      this.reject(error);
    });
  }

  run() {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.close = openTerminal(this.stdin, this.stdout, () => this.draw(), this.onKeypress, () => {
        this.interrupted = true;
        if (!this.busy) this.finish(false);
      }, reject);
    });
  }

  finish(saved) {
    if (this.closed) return;
    this.closed = true;
    this.close();
    this.resolve({ saved, preferences: this.preferences });
  }

  async handle(key) {
    if (this.busy || this.closed) return;
    if (key === "cancel") {
      this.finish(false);
      return;
    }
    if (key === "save") {
      await this.save();
      return;
    }
    if (key === "up") this.moveField(-1);
    else if (key === "down") this.moveField(1);
    else if (key === "left") this.change(-1);
    else if (key === "right") this.change(1);
    else if (key === "toggle") this.toggleSegment();
    else if (key === "reorder-down") this.reorder(1);
    else if (key === "reorder-up") this.reorder(-1);
    else if (key === "help") this.help = !this.help;
    else return;
    this.draw();
  }

  moveField(delta) {
    this.field = (this.field + delta + FIELDS.length) % FIELDS.length;
  }

  change(delta) {
    const field = FIELDS[this.field];
    if (field === "segments") {
      this.segment = (this.segment + delta + SEGMENT_REGISTRY.length) % SEGMENT_REGISTRY.length;
      return;
    }
    const names = namesFor(field);
    const current = this.preferences[field];
    const index = Math.max(0, names.indexOf(current));
    const next = names[(index + delta + names.length) % names.length];
    this.applyField(field, next);
  }

  applyField(field, value) {
    if (field === "preset") {
      this.preferences = normalizePreferences({ preset: value });
      this.segment = 0;
      return;
    }
    this.preferences = normalizePreferences({ ...this.preferences, [field]: value });
  }

  toggleSegment() {
    if (FIELDS[this.field] !== "segments") {
      this.field = FIELDS.indexOf("segments");
    }
    const id = SEGMENT_REGISTRY[this.segment].id;
    const segments = this.preferences.segments.slice();
    const at = segments.indexOf(id);
    if (at >= 0) {
      if (segments.length === 1) return;
      segments.splice(at, 1);
    } else {
      segments.push(id);
    }
    this.preferences = normalizePreferences({ ...this.preferences, segments });
  }

  reorder(delta) {
    this.field = FIELDS.indexOf("segments");
    const segments = this.preferences.segments.slice();
    if (segments.length < 2) return;
    const from = segments.indexOf(SEGMENT_REGISTRY[this.segment].id);
    if (from < 0) return;
    const to = (from + delta + segments.length) % segments.length;
    const [item] = segments.splice(from, 1);
    segments.splice(to, 0, item);
    this.preferences = normalizePreferences({ ...this.preferences, segments });
  }

  async save() {
    this.busy = true;
    try {
      await this.onSave(this.preferences);
    } catch (error) {
      this.busy = false;
      if (this.interrupted) throw error;
      this.error = this.strings.saveError(sanitizeText(error.message));
      this.draw();
      return;
    }
    this.finish(true);
  }

  draw() {
    if (this.closed) return;
    const columns = this.stdout.columns || 80;
    const rows = this.stdout.rows || 24;
    const narrow = columns < 60 || rows < 24;
    const bodyRows = rows - 1;
    let lines;
    if (rows === 1) lines = [this.fieldLine(FIELDS[this.field], true, false)];
    else if (narrow) lines = this.narrowLines(columns, bodyRows);
    else lines = this.wideLines(columns, bodyRows);
    while (lines.length < bodyRows) lines.push("");
    if (rows > 1) lines.push(this.footer(narrow));
    this.stdout.write(CLEAR + lines.map((line) => clip(line, columns)).join("\n"));
  }

  wideLines(columns, rows) {
    const strings = this.strings;
    const header = [title(strings.title), dim(strings.sample), ""];
    const fields = FIELDS.map((field, index) => this.fieldLine(field, index === this.field));
    const settings = ["", ...fields, "", dim(strings.segmentKeys)];
    const help = this.help ? ["", ...strings.help.map(dim)] : [];
    const available = rows - header.length - settings.length - help.length;
    // Leave room for at least four entries in the segment catalog.
    const preview = this.preview(columns - 4).slice(0, available - 4);
    const count = Math.min(SEGMENT_REGISTRY.length, available - preview.length);
    const start = Math.max(0, Math.min(this.segment - Math.floor(count / 2), SEGMENT_REGISTRY.length - count));
    const catalog = SEGMENT_REGISTRY.slice(start, start + count).map((segment, index) => {
      const order = this.preferences.segments.indexOf(segment.id);
      const mark = order < 0 ? " ." : String(order + 1).padStart(2, " ");
      const current = start + index === this.segment && FIELDS[this.field] === "segments";
      const [label, hint] = segmentText(segment, this.language);
      return `${current ? ">" : " "} ${mark} ${padVisible(label, 14)} ${dim(hint)}`;
    });
    return [...header, ...preview.map((line) => `  ${line}`), ...settings, ...catalog, ...help];
  }

  narrowLines(columns, rows) {
    const strings = this.strings;
    const header = rows >= 3 ? [title(strings.shortTitle)] : [];
    const controls = rows >= 8 ? [""] : [];
    controls.push(this.fieldLine(FIELDS[this.field], true, columns >= 32));
    if (rows >= 10) controls.push("");
    if (rows >= 4) controls.push(dim(strings.shortMove));
    if (rows >= 5) controls.push(dim(strings.shortSegment));
    if (this.help && rows >= 6) controls.push(dim(strings.shortHelp));
    const previewRows = rows - header.length - controls.length;
    const preview = previewRows > 0 ? this.preview(columns).slice(0, previewRows) : [];
    return [...header, ...preview, ...controls];
  }

  fieldLine(field, active, aligned = true) {
    const strings = this.strings;
    let value = this.preferences[field];
    if (field === "segments") {
      const selected = SEGMENT_REGISTRY[this.segment];
      const position = this.preferences.segments.indexOf(selected.id);
      const [label] = segmentText(selected, this.language);
      value = `${label} (${position < 0 ? strings.off : `#${position + 1}`})`;
    } else if (field === "colorDepth") value = strings.depths[value] ?? value;
    const cursor = active ? ">" : " ";
    const label = strings.fields[field];
    return `${cursor} ${aligned ? padVisible(label, 11) : label} ${value}`;
  }

  preview(width) {
    const payload = samplePayload(width);
    const segments = collectSegments(payload, this.preferences, SAMPLE_GIT);
    const lines = renderLine(segments, this.preferences, { width, color: true }).split(/\r?\n/);
    return lines.some((line) => visibleWidth(line) > 0) ? lines : [dim(this.strings.noSegments)];
  }

  footer(narrow) {
    const strings = this.strings;
    return dim(this.error || (narrow ? strings.shortFooter : this.help ? strings.helpFooter : strings.footer));
  }
}

function openTerminal(stdin, stdout, draw, onKeypress, cancel, onError) {
  const wasRaw = stdin.isRaw;
  let closed = false;
  const interrupt = () => { process.exitCode = 130; cancel(); };
  const terminate = () => { process.exitCode = 143; cancel(); };
  const close = () => {
    if (closed) return;
    closed = true;
    stdin.off("keypress", onKeypress);
    stdin.pause();
    stdout.off("resize", redraw);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    try { stdin.setRawMode(wasRaw); } catch { /* The terminal may have closed. */ }
    try { stdout.write(RESET + SHOW_CURSOR + LEAVE_ALT); } catch { /* The terminal may have closed. */ }
  };
  const redraw = () => {
    try {
      draw();
    } catch (error) {
      close();
      onError(error);
    }
  };
  try {
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.on("keypress", onKeypress);
    stdin.resume();
    stdout.on("resize", redraw);
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    stdout.write(ENTER_ALT + HIDE_CURSOR);
    redraw();
  } catch (error) {
    close();
    throw error;
  }
  return close;
}

function keyAction(text, key) {
  if (key?.ctrl) return key.name === "c" ? "cancel" : undefined;
  if (key?.name === "escape" || text === "q" || text === "Q") return "cancel";
  if (key?.name === "return" || key?.name === "enter") return "save";
  if (["up", "down", "left", "right"].includes(key?.name)) return key.name;
  return { h: "left", l: "right", j: "down", k: "up", J: "reorder-down", K: "reorder-up", " ": "toggle", "?": "help" }[text];
}

function namesFor(field) {
  if (field === "preset") return Object.keys(PRESETS);
  if (field === "theme") return Object.keys(THEMES);
  if (field === "skin") return Object.keys(SKINS);
  if (field === "icons") return Object.keys(ICON_SETS);
  if (field === "colorDepth") return Object.keys(COLOR_DEPTHS);
  return [];
}

function title(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

function dim(text) {
  return `\x1b[2m${text}\x1b[0m`;
}

function clip(text, columns) {
  if (visibleWidth(text) <= columns) return text;
  return `${truncateVisible(text, columns - 1)}…`;
}
