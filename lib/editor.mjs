/**
 * Full-screen alternate-buffer editor.
 *
 * One preferences object drives the live preview through the same renderLine
 * the installed command uses. Keys are read in raw mode. Cleanup always
 * restores the main buffer, the cursor, and cooked input, including signals
 * and a failed draw.
 */

import { emitKeypressEvents } from "node:readline";
import { colorDepth, padVisible, sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
import { editorStrings, segmentText } from "./editor-i18n.mjs";
import {
  COLOR_DEPTHS,
  CONTEXT_FORMATS,
  DIR_STYLES,
  ICON_SETS,
  ITEM_FIELDS,
  ITEM_FORMAT_PRESETS,
  ITEM_ICON_PRESETS,
  PRESETS,
  QUOTA_PACES,
  SEGMENT_REGISTRY,
  SKINS,
  THEMES,
  defaultWidgetFor,
  normalizePreferences,
  presetBaseItem,
  presetRows,
} from "./preferences.mjs";
import { UPSTREAM_ICONS, renderLine, resolveIcon } from "./render.mjs";
import { SAMPLE_GIT, SAMPLE_HOME, samplePayload } from "./sample.mjs";
import { collectSegments } from "./segments.mjs";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";
const RESET = "\x1b[0m";

const FIELDS = ["preset", "theme", "skin", "icons", "colorDepth", "contextFormat", "quotaPace", "dirStyle", "segments"];
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
      if (action === "cancel" || action === "back") return finish(null);
      if (action === "confirm") return finish(LANGUAGES[selected].code);
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
      const action = keyAction(text, key);
      if (text?.toLowerCase() === "y") finish(true);
      else if (text?.toLowerCase() === "n" || action === "cancel" || action === "back") finish(false);
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
    this.itemField = 0;
    this.textEdit = null;
    this.mode = "settings";
    this.grab = null;
    this.closed = false;
    this.busy = false;
    this.interrupted = false;
    this.help = false;
    this.error = "";
    this.onKeypress = (text, key) => this.handleKeypress(text, key).catch((error) => {
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

  async handleKeypress(text, key) {
    if (this.busy || this.closed) return;
    if (this.mode === "item" && this.textEdit) {
      if (key?.ctrl && key.name === "c") {
        this.finish(false);
        return;
      }
      if (key?.ctrl && key.name === "s") {
        this.textEdit = null;
        await this.save();
        return;
      }
      this.handleTextEdit(text, key);
      if (!this.closed) this.draw();
      return;
    }
    await this.handle(keyAction(text, key));
  }

  async handle(key) {
    if (this.busy || this.closed) return;
    if (key === "cancel" || (key === "back" && this.mode === "settings")) {
      this.finish(false);
      return;
    }
    if (key === "save" || (key === "confirm" && this.mode === "settings" && FIELDS[this.field] !== "segments")) {
      await this.save();
      return;
    }
    if (this.mode === "settings") this.handleSettings(key);
    else if (this.mode === "layout") this.handleLayout(key);
    else this.handleItem(key);
    if (!this.closed) this.draw();
  }

  handleSettings(key) {
    if (key === "up") this.moveField(-1);
    else if (key === "down") this.moveField(1);
    else if (key === "left") this.change(-1);
    else if (key === "right") this.change(1);
    else if (key === "help") this.help = !this.help;
    else if ((key === "confirm" || key === "toggle") && FIELDS[this.field] === "segments") this.openLayout();
  }

  handleLayout(key) {
    if (key === "back") {
      if (this.grab) this.restoreGrab();
      else this.mode = "settings";
      return;
    }
    if (key === "confirm") {
      if (this.grab) this.grab = null;
      else if (this.activeIds().includes(this.selectedId())) this.pickup();
      return;
    }
    if (key === "up" || key === "down") {
      if (this.grab) this.moveGrabbed(key === "down" ? 1 : -1);
      else this.moveSelection(key === "down" ? 1 : -1);
      return;
    }
    if (key === "toggle" && !this.grab) this.toggleSelected();
    else if ((key === "edit" || key === "right") && !this.grab && this.activeIds().includes(this.selectedId())) {
      this.openItem();
    }
  }

  openItem() {
    this.mode = "item";
    this.itemField = 0;
    this.textEdit = null;
  }

  handleItem(key) {
    const id = this.selectedId();
    const controls = this.itemControls(id);
    this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));
    const prop = controls[this.itemField];
    if (key === "back") {
      this.mode = "layout";
      this.textEdit = null;
      return;
    }
    if (key === "up") {
      this.itemField = (this.itemField - 1 + controls.length) % controls.length;
      return;
    }
    if (key === "down") {
      this.itemField = (this.itemField + 1) % controls.length;
      return;
    }
    if (key === "left") {
      this.cycleItemProp(id, prop, -1);
      return;
    }
    if (key === "right") {
      this.cycleItemProp(id, prop, 1);
      return;
    }
    if (key === "reset") {
      this.setItemProp(id, prop, undefined);
      return;
    }
    if (key === "confirm") {
      if (prop === "widget") {
        this.cycleItemProp(id, prop, 1);
      } else {
        const current = this.preferences.items?.[id]?.[prop] ?? (prop === "icon" ? this.resolvedIcon(id) : this.resolvedFormat(id));
        this.textEdit = { prop, value: current, original: this.preferences };
      }
    }
  }

  handleTextEdit(text, key) {
    const id = this.selectedId();
    const edit = this.textEdit;
    if (key?.name === "escape") {
      this.preferences = edit.original;
      this.textEdit = null;
      return;
    }
    if (key?.name === "return" || key?.name === "enter") {
      this.textEdit = null;
      return;
    }
    if (key?.name === "backspace") {
      edit.value = [...edit.value].slice(0, -1).join("");
      this.applyTextEdit(id, edit.prop, edit.value);
      return;
    }
    if (typeof text === "string" && text.length > 0 && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) {
      const limit = edit.prop === "icon" ? 16 : 120;
      const chars = [...edit.value, ...sanitizeText(text)].slice(0, limit);
      edit.value = chars.join("");
      this.applyTextEdit(id, edit.prop, edit.value);
    }
  }

  applyTextEdit(id, prop, value) {
    if (prop === "format") {
      const trimmed = value.trim();
      this.setItemProp(id, "format", trimmed ? trimmed : undefined);
    } else {
      this.setItemProp(id, "icon", value);
    }
  }

  itemControls(id) {
    const controls = [];
    if (this.widgetChoices(id).length > 1) controls.push("widget");
    const widget = this.effectiveWidget(id);
    if (!(widget === "gauge" && this.preferences.icons !== "ascii")) controls.push("icon");
    if (!(id === "subagents" && widget === "tree")) controls.push("format");
    return controls;
  }

  widgetChoices(id) {
    const native = Boolean(PRESETS[this.preferences.preset]?.rows);
    const depth = colorDepth(this.preferences.colorDepth, { enabled: true });
    if (id === "context") {
      if (this.preferences.icons === "ascii") return native ? ["bar", "text"] : ["legacy-bar", "bar", "text"];
      return native ? ["gauge", "bar", "text"] : ["gauge", "bar", "text", "legacy-bar"];
    }
    if (id === "quota.5h" || id === "quota.7d") {
      const choices = [];
      if ((this.preferences.icons !== "ascii" && depth !== "none") || this.preferences.quotaPace === "auto") {
        choices.push("pace");
      }
      choices.push("bar");
      if (this.preferences.icons !== "ascii") choices.push("gauge");
      choices.push("text");
      return choices;
    }
    if (id === "cache") {
      return this.preferences.icons === "ascii" ? ["text", "bar"] : ["text", "bar", "gauge"];
    }
    if (id === "subagents") {
      return ["tree", "inline"];
    }
    return [];
  }

  defaultWidget(id) {
    const native = Boolean(PRESETS[this.preferences.preset]?.rows);
    const base = presetBaseItem(this.preferences, id);
    return defaultWidgetFor(id, base, {
      native,
      icons: this.preferences.icons,
      preset: this.preferences.preset,
    });
  }

  effectiveWidget(id) {
    return this.preferences.items?.[id]?.widget ?? this.defaultWidget(id);
  }

  resolvedIcon(id) {
    const native = Boolean(PRESETS[this.preferences.preset]?.rows);
    const base = presetBaseItem(this.preferences, id);
    return resolveIcon(base, id, { icons: this.preferences.icons, native });
  }

  resolvedFormat(id) {
    const base = presetBaseItem(this.preferences, id);
    if (id === "context") {
      const cf = this.preferences.contextFormat ?? "auto";
      const prefix = base.format?.startsWith("ctx ") ? "ctx " : "";
      if (cf === "percent") return `${prefix}{pct}%`;
      if (cf === "tokens") return `${prefix}{pct}%[ · {tokens}]`;
      if (cf === "ratio") return `${prefix}{pct}%[ · {tokens}[/{window}]]`;
      if (base.format) return base.format;
      return PRESETS[this.preferences.preset]?.rows ? "{pct}%[ · {tokens}]" : "{pct}%";
    }
    if (id === "quota.5h" || id === "quota.7d") {
      if (base.format) return base.format;
      const prefix = id.slice(6);
      const widget = this.effectiveWidget(id);
      const showPace = this.preferences.quotaPace === "show"
        || (this.preferences.quotaPace === "auto" && widget === "pace");
      return showPace ? `${prefix} {pct}%[ {arrow}][ · {left}]` : `${prefix} {pct}%[ · {left}]`;
    }
    if (base.format) return base.format;
    return ITEM_FORMAT_PRESETS[id]?.[0] ?? "";
  }

  iconChoices(id) {
    const defaultGlyph = this.resolvedIcon(id);
    const upstream = UPSTREAM_ICONS[id] ?? (id.startsWith("quota.") ? UPSTREAM_ICONS.quota : []);
    const nerdPresets = (ITEM_ICON_PRESETS[id] ?? []).map((entry) => entry.glyph);
    const candidates = [
      ...(defaultGlyph === "" ? [] : [""]),
      upstream[0],
      ICON_SETS.nerd[id],
      ...nerdPresets,
      upstream[1],
      ICON_SETS.unicode[id],
      ICON_SETS.ascii[id],
    ];
    const current = this.preferences.items?.[id]?.icon;
    if (current != null && !candidates.includes(current)) candidates.push(current);
    const seen = new Set();
    const unique = candidates.filter((choice) => {
      if (typeof choice !== "string") return false;
      if (choice === defaultGlyph) return false;
      if (seen.has(choice)) return false;
      seen.add(choice);
      return true;
    });
    return [undefined, ...unique];
  }

  formatChoices(id) {
    const defaultFormat = this.resolvedFormat(id);
    const presets = ITEM_FORMAT_PRESETS[id] ?? [];
    const current = this.preferences.items?.[id]?.format;
    const raw = [undefined, ...presets, ...(current ? [current] : [])];
    const seen = new Set();
    return raw.filter((choice) => {
      if (choice === undefined) return true;
      if (choice === defaultFormat && choice !== current) return false;
      if (seen.has(choice)) return false;
      seen.add(choice);
      return true;
    });
  }

  cycleItemProp(id, prop, delta) {
    const defaultWidget = this.defaultWidget(id);
    const currentWidget = this.preferences.items?.[id]?.widget;
    const widgetCycle = [
      undefined,
      ...this.widgetChoices(id).filter(w => w !== defaultWidget || w === currentWidget),
    ];
    const choices = prop === "widget" ? widgetCycle
      : prop === "icon" ? this.iconChoices(id)
      : this.formatChoices(id);
    const current = this.preferences.items?.[id]?.[prop];
    const index = Math.max(0, choices.indexOf(current));
    const next = choices[(index + delta + choices.length) % choices.length];
    this.setItemProp(id, prop, next);
  }

  setItemProp(id, prop, value) {
    const items = { ...(this.preferences.items ?? {}) };
    const entry = { ...(items[id] ?? {}) };
    if (value === undefined) delete entry[prop];
    else entry[prop] = value;
    if (Object.keys(entry).length === 0) delete items[id];
    else items[id] = entry;
    const next = { ...this.preferences };
    if (Object.keys(items).length > 0) next.items = items;
    else delete next.items;
    this.preferences = normalizePreferences(next);
    const controls = this.itemControls(id);
    this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));
  }

  openLayout() {
    this.mode = "layout";
    this.grab = null;
    if (!this.selectedId()) this.segment = 0;
  }

  selectedId() {
    return this.entries()[this.segment]?.id;
  }

  entries() {
    const active = this.activeIds();
    const disabled = SEGMENT_REGISTRY.map((segment) => segment.id).filter((id) => !active.includes(id));
    return [...active, ...disabled].map((id) => SEGMENT_REGISTRY.find((segment) => segment.id === id));
  }

  activeIds() {
    return this.preferences.segments;
  }

  moveSelection(delta) {
    const count = this.entries().length;
    const next = this.segment + delta;
    if (next < 0 || next >= count) return;
    this.segment = next;
  }

  moveField(delta) {
    this.field = (this.field + delta + FIELDS.length) % FIELDS.length;
  }

  change(delta) {
    const field = FIELDS[this.field];
    if (field === "segments") return;
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

  pickup() {
    const id = this.selectedId();
    this.grab = { id, preferences: this.preferences };
  }

  restoreGrab() {
    this.preferences = this.grab.preferences;
    this.segment = this.entries().findIndex((segment) => segment.id === this.grab.id);
    this.grab = null;
  }

  moveGrabbed(delta) {
    const id = this.grab.id;
    const active = this.activeIds();
    const from = active.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= active.length) return;
    const rows = presetRows(this.preferences);
    const slots = rows.flatMap((row, rowIndex) => ["left", "right"].flatMap((side) => (
      row[side].map((_, index) => ({ row: rowIndex, side, index }))
    )));
    const origin = slots[from];
    const target = slots[to];
    const moving = rows[origin.row][origin.side][origin.index];
    const displaced = rows[target.row][target.side][target.index];
    rows[origin.row][origin.side][origin.index] = displaced;
    rows[target.row][target.side][target.index] = moving;
    this.commitRows(rows);
    this.selectId(id);
  }

  toggleSelected() {
    const id = this.selectedId();
    const active = this.activeIds();
    if (!id) return;
    if (active.includes(id)) {
      if (active.length === 1) return;
      const rows = presetRows(this.preferences).map((row) => ({
        left: row.left.filter((item) => item.metric !== id),
        right: row.right.filter((item) => item.metric !== id),
      })).filter((row) => row.left.length || row.right.length);
      this.commitRows(rows);
    } else {
      const rows = presetRows(this.preferences);
      const last = rows.at(-1);
      if (last && !last.right.length) last.left.push({ metric: id });
      else rows.push({ left: [{ metric: id }], right: [] });
      this.commitRows(rows);
    }
    this.selectId(id);
  }

  selectId(id) {
    const index = this.entries().findIndex((segment) => segment.id === id);
    if (index >= 0) this.segment = index;
  }

  commitRows(rows) {
    const segments = rows.flatMap((row) => [...row.left, ...row.right].map((item) => item.metric));
    const layout = this.preferences.layout && this.preferences.layout !== "flat"
      ? rows.filter(row => row.left.length || row.right.length).map(row => [row.left.length, row.right.length])
      : "flat";
    this.preferences = normalizePreferences({ ...this.preferences, segments, layout });
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
    if (this.mode === "layout") lines = this.layoutLines(columns, bodyRows);
    else if (this.mode === "item") lines = this.itemLines(columns, bodyRows);
    else if (rows === 1) lines = [this.fieldLine(FIELDS[this.field], true, false)];
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
    const settings = ["", ...fields];
    const help = this.help ? ["", ...strings.help.map(dim)] : [];
    const preview = this.preview(columns - 4).slice(0, Math.max(0, rows - header.length - settings.length - help.length));
    return [...header, ...preview.map(line => `  ${line}`), ...settings, ...help];
  }

  layoutLines(columns, rows) {
    const strings = this.strings;
    const header = rows >= 4 ? [title(strings.layoutTitle)] : [];
    const hint = rows >= 3 ? [dim(this.grab ? strings.grabbedKeys : strings.layoutKeys)] : [];
    const previewBudget = Math.max(0, Math.min(4, rows - header.length - hint.length - 5));
    const preview = this.preview(Math.max(1, columns - 2)).slice(0, previewBudget);
    const room = Math.max(1, rows - header.length - hint.length - preview.length);
    const entries = this.entries();
    const start = Math.max(0, Math.min(this.segment - Math.floor((room - 1) / 2), entries.length - room));
    const activeCount = this.activeIds().length;
    const slots = placement(this.preferences);
    const lines = entries.slice(start, start + room).map((segment, index) => {
      const at = start + index;
      const [label] = segmentText(segment, this.language);
      const enabled = at < activeCount;
      const where = slots.get(segment.id);
      const custom = this.preferences.items?.[segment.id] ? ` · ${strings.customTag}` : "";
      const place = where ? `${strings.rowSide(where.row + 1, where.side)}${custom}` : strings.disabled;
      const state = this.grab?.id === segment.id ? strings.grabbed : enabled ? strings.enabled : strings.off;
      const cursor = at === this.segment ? ">" : " ";
      return `${cursor} ${padVisible(label, 14)} ${padVisible(state, 8)} ${dim(place)}`;
    });
    return [...header, ...preview.map(line => `  ${line}`), ...hint, ...lines];
  }

  itemLines(columns, rows) {
    const strings = this.strings;
    const id = this.selectedId();
    const segment = SEGMENT_REGISTRY.find((entry) => entry.id === id) ?? { id, label: id };
    const [label] = segmentText(segment, this.language);
    const controls = this.itemControls(id);
    this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));
    const header = rows >= 4 ? [title(strings.itemTitle(label))] : [];
    const blockLines = this.segmentPreviewLines(id);
    const blockPrefix = `  ${dim(strings.itemPreview)} `;
    const blockIndent = " ".repeat(visibleWidth(blockPrefix));
    const blockLine = blockLines.length && rows >= 5
      ? blockLines.slice(0, rows >= 12 ? 2 : 1).map((line, index) => `${index === 0 ? blockPrefix : blockIndent}${line}`)
      : [];
    const hint = rows >= 3 ? [dim(this.textEdit ? strings.itemTypingKeys : strings.itemKeys)] : [];
    const showFieldHint = controls.includes("format") && rows >= 8 && ITEM_FIELDS[id]?.length;
    const fieldHint = showFieldHint
      ? ["", dim(strings.itemAvailableFields(ITEM_FIELDS[id].map(name => `{${name}}`).join(" ")))]
      : [];
    const controlLines = controls.map((prop, index) => this.itemFieldLine(id, prop, index === this.itemField));
    const used = header.length + blockLine.length + hint.length + controlLines.length + fieldHint.length + 1;
    const previewBudget = Math.max(0, Math.min(4, rows - used));
    const preview = previewBudget > 0 ? this.preview(Math.max(1, columns - 2)).slice(0, previewBudget) : [];
    const spacer = rows >= 7 ? [""] : [];
    return [...header, ...preview.map(line => `  ${line}`), ...blockLine, ...spacer, ...hint, ...controlLines, ...fieldHint];
  }

  itemFieldLine(id, prop, active) {
    const strings = this.strings;
    const override = this.preferences.items?.[id]?.[prop];
    let value;
    if (this.textEdit?.prop === prop) {
      value = `${this.textEdit.value}_`;
    } else if (prop === "widget") {
      const effective = this.effectiveWidget(id);
      const hint = strings.widgetHints?.[effective];
      const base = override == null ? `${strings.itemDefault} (${effective})` : override;
      value = hint ? `${base}  ${dim(hint)}` : base;
    } else if (prop === "icon") {
      if (override == null) {
        const resolved = this.resolvedIcon(id);
        value = `${strings.itemDefault} (${resolved || strings.itemNone})`;
      } else if (override === "") {
        value = strings.itemNone;
      } else {
        const preset = (ITEM_ICON_PRESETS[id] ?? []).find((entry) => entry.glyph === override);
        value = preset ? `${override}  ${dim(preset.name)}` : override;
      }
    } else {
      value = override == null ? `${strings.itemDefault} (${this.resolvedFormat(id)})` : override;
    }
    const cursor = active ? ">" : " ";
    const label = strings.itemFields[prop] ?? prop;
    return `${cursor} ${padVisible(label, 10)} ${value}`;
  }

  segmentPreviewLines(id, width = 0) {
    const payload = samplePayload(width);
    const hasRows = Boolean(PRESETS[this.preferences.preset]?.rows) && this.preferences.layout !== "flat";
    const singlePrefs = {
      ...this.preferences,
      segments: [id],
      ...(hasRows ? { layout: "preset" } : {}),
    };
    const segments = collectSegments(payload, singlePrefs, SAMPLE_GIT, { home: SAMPLE_HOME });
    return renderLine(segments, singlePrefs, { width, color: true }).split(/\r?\n/).filter(Boolean);
  }

  narrowLines(columns, rows) {
    const strings = this.strings;
    const header = rows >= 3 ? [title(strings.shortTitle)] : [];
    const controls = rows >= 8 ? [""] : [];
    controls.push(this.fieldLine(FIELDS[this.field], true, columns >= 32));
    if (rows >= 10) controls.push("");
    if (rows >= 4) controls.push(dim(strings.shortMove));
    if (rows >= 5 && FIELDS[this.field] === "segments") controls.push(dim(strings.shortSegment));
    if (this.help && rows >= 6) controls.push(dim(strings.shortHelp));
    const previewRows = rows - header.length - controls.length;
    const preview = previewRows > 0 ? this.preview(columns).slice(0, previewRows) : [];
    return [...header, ...preview, ...controls];
  }

  fieldLine(field, active, aligned = true) {
    const strings = this.strings;
    let value = this.preferences[field];
    if (field === "segments") {
      value = `${this.activeIds().length}/${SEGMENT_REGISTRY.length} ${strings.enabled}`;
    } else if (field === "colorDepth") value = strings.depths[value] ?? value;
    else if (field === "contextFormat") value = strings.contextFormats[value] ?? value;
    else if (field === "quotaPace") value = strings.quotaPaces[value] ?? value;
    else if (field === "dirStyle") value = strings.dirStyles[value] ?? value;
    const cursor = active ? ">" : " ";
    const label = strings.fields[field];
    return `${cursor} ${aligned ? padVisible(label, 11) : label} ${value}`;
  }

  preview(width) {
    const payload = samplePayload(width);
    const segments = collectSegments(payload, this.preferences, SAMPLE_GIT, { home: SAMPLE_HOME });
    const lines = renderLine(segments, this.preferences, { width, color: true }).split(/\r?\n/);
    return lines.some((line) => visibleWidth(line) > 0) ? lines : [dim(this.strings.noSegments)];
  }

  footer(narrow) {
    const strings = this.strings;
    const base = this.mode === "item" ? (this.textEdit ? strings.itemTypingKeys : strings.itemFooter)
      : this.mode === "layout" ? (this.grab ? strings.grabbedKeys : strings.layoutFooter)
      : FIELDS[this.field] === "segments" ? strings.segmentKeys
      : narrow ? strings.shortFooter : this.help ? strings.helpFooter : strings.footer;
    return dim(this.error || base);
  }
}

function placement(preferences) {
  const slots = new Map();
  presetRows(preferences).forEach((row, rowIndex) => {
    for (const side of ["left", "right"]) {
      for (const item of row[side]) {
        if (!slots.has(item.metric)) slots.set(item.metric, { row: rowIndex, side });
      }
    }
  });
  return slots;
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
  if (key?.ctrl && key.name === "c") return "cancel";
  if (key?.ctrl && key.name === "s") return "save";
  if (text === "q" || text === "Q") return "cancel";
  if (key?.name === "escape") return "back";
  if (key?.name === "return" || key?.name === "enter") return "confirm";
  if (["up", "down", "left", "right"].includes(key?.name)) return key.name;
  return { h: "left", l: "right", j: "down", k: "up", " ": "toggle", "?": "help", e: "edit", r: "reset" }[text];
}

function namesFor(field) {
  if (field === "preset") return Object.keys(PRESETS);
  if (field === "theme") return Object.keys(THEMES);
  if (field === "skin") return Object.keys(SKINS);
  if (field === "icons") return Object.keys(ICON_SETS);
  if (field === "colorDepth") return Object.keys(COLOR_DEPTHS);
  if (field === "contextFormat") return Object.keys(CONTEXT_FORMATS);
  if (field === "quotaPace") return Object.keys(QUOTA_PACES);
  if (field === "dirStyle") return Object.keys(DIR_STYLES);
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
