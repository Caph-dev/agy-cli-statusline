/**
 * Full-screen alternate-buffer editor.
 *
 * One preferences object drives the live preview through the same renderLine
 * the installed command uses. Keys are read in raw mode. Cleanup always
 * restores the main buffer, the cursor, and cooked input, including signals
 * and a failed draw.
 */

import { emitKeypressEvents } from "node:readline";
import { sanitizeText } from "./ansi.mjs";
import { ICON_SETS, PRESETS, SEGMENT_REGISTRY, SKINS, THEMES, normalizePreferences } from "./preferences.mjs";
import { renderLine } from "./render.mjs";
import { SAMPLE_GIT, samplePayload } from "./sample.mjs";
import { collectSegments } from "./segments.mjs";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";
const RESET = "\x1b[0m";

const FIELDS = ["preset", "theme", "skin", "icons", "segments"];

export async function confirmReplace({ stdin = process.stdin, stdout = process.stdout, command = "" } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  return new Promise((resolve, reject) => {
    const finish = (value) => {
      close();
      resolve(value);
    };
    const draw = () => {
      const columns = stdout.columns || 80;
      const shown = command ? `  ${sanitizeText(command)}` : "  (empty)";
      const lines = [
        title("Replace the current status line?"),
        "",
        shown,
        "",
        "  y replaces it and backs up settings.json",
        "  n or esc keeps it",
      ];
      stdout.write(CLEAR + lines.map((line) => clip(line, columns)).join("\n"));
    };
    const close = openTerminal(stdin, stdout, draw, (text, key) => {
      if (text?.toLowerCase() === "y") finish(true);
      else if (text?.toLowerCase() === "n" || keyAction(text, key) === "cancel") finish(false);
    }, () => finish(false), reject);
  });
}

export async function runEditor({ preferences, stdin = process.stdin, stdout = process.stdout, onSave }) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("the editor needs a TTY; on a pipe, run configure --show or configure with flags");
  }
  const session = new Session(normalizePreferences(preferences), { stdin, stdout, onSave });
  return session.run();
}

class Session {
  constructor(preferences, { stdin, stdout, onSave }) {
    this.preferences = preferences;
    this.stdin = stdin;
    this.stdout = stdout;
    this.onSave = onSave;
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
      this.error = error.message;
      this.draw();
      return;
    }
    this.finish(true);
  }

  draw() {
    const columns = this.stdout.columns || 80;
    const rows = this.stdout.rows || 24;
    const narrow = columns < 60 || rows < 24;
    const lines = narrow ? this.narrowLines(columns) : this.wideLines(columns);
    const body = lines.slice(0, Math.max(1, rows - 1));
    while (body.length < rows - 1) body.push("");
    const status = this.footer(columns);
    if (this.closed) return;
    this.stdout.write(CLEAR + body.join("\n") + "\n" + status);
  }

  wideLines(columns) {
    const preview = this.preview(columns - 4);
    const lines = [
      title("Status Line Studio"),
      dim("Sample data. Nothing here is your live session."),
      "",
      "  " + preview,
      "",
    ];
    FIELDS.forEach((field, index) => {
      lines.push(this.fieldLine(field, index === this.field, columns));
    });
    lines.push("");
    lines.push(dim("Segments  space toggle   K/J reorder   arrows change"));
    for (const segment of SEGMENT_REGISTRY) {
      const on = this.preferences.segments.includes(segment.id);
      const order = this.preferences.segments.indexOf(segment.id);
      const mark = on ? String(order + 1).padStart(2, " ") : " .";
      const current = SEGMENT_REGISTRY[this.segment].id === segment.id && FIELDS[this.field] === "segments";
      const row = `${current ? ">" : " "} ${mark} ${segment.label.padEnd(12, " ")} ${dim(segment.hint)}`;
      lines.push(clip(row, columns));
    }
    if (this.help) {
      lines.push("");
      lines.push(dim("left/right or h/l change the selected field"));
      lines.push(dim("up/down or j/k move between fields"));
      lines.push(dim("on Segments: space enables, K/J moves the selected row"));
      lines.push(dim("enter writes preferences and installs; q or esc cancels"));
    }
    if (this.error) lines.push("", `  ${this.error}`);
    return lines;
  }

  narrowLines(columns) {
    const field = FIELDS[this.field];
    return [
      title("Studio"),
      clip(this.preview(columns), columns),
      "",
      this.fieldLine(field, true, columns),
      "",
      dim("j/k field  h/l change"),
      dim("space toggle  K/J move"),
      dim("enter save  q cancel"),
      this.help ? dim("h/l value, space segment") : "",
      this.error ? this.error : "",
    ];
  }

  fieldLine(field, active, columns) {
    const selected = SEGMENT_REGISTRY[this.segment];
    const position = this.preferences.segments.indexOf(selected.id);
    const value = field === "segments"
      ? `${selected.label} (${position < 0 ? "off" : `#${position + 1}`})`
      : this.preferences[field];
    const cursor = active ? ">" : " ";
    return clip(`${cursor} ${field.padEnd(10, " ")} ${value}`, columns);
  }

  preview(width) {
    const payload = samplePayload(width);
    const segments = collectSegments(payload, this.preferences, SAMPLE_GIT);
    const line = renderLine(segments, this.preferences, { width, color: true });
    return line || dim("no visible segments");
  }

  footer(columns) {
    const message = this.error || (this.help
      ? "j/k field · h/l value · space toggle · K/J reorder"
      : "enter save    q or esc cancel    ? help");
    return clip(dim(message), columns);
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
  return [];
}

function title(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

function dim(text) {
  return `\x1b[2m${text}\x1b[0m`;
}

function clip(text, columns) {
  if (columns < 2) return "";
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (plain.length <= columns) return text;
  return `${plain.slice(0, Math.max(0, columns - 1))}\u2026`;
}
