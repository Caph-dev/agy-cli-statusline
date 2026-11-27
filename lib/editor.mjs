/**
 * Full-screen alternate-buffer studio editor.
 *
 * Three pages — Presets gallery, Segment Layout (+ per-item editor), and Style —
 * share an interactive live-preview footer powered by the exact same renderLine
 * pipeline the installed status line uses.
 */

import { emitKeypressEvents } from "node:readline";
import { colorDepth, fitAnsi, padVisible, sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
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
  layoutModeOf,
  normalizePreferences,
  presetBaseItem,
  presetHasStructuredLayout,
  presetRows,
  seedCustomLayout,
} from "./preferences.mjs";
import {
  PRESET_FILTERS,
  PresetLibrary,
  applyPreset,
  formatEditedAgo,
  isPresetInUse,
  matchesPreset,
  presetNameProblem,
  slugifyPresetName,
} from "./presets-library.mjs";
import { UPSTREAM_ICONS, renderLine, resolveIcon } from "./render.mjs";
import { PREVIEW_SCENARIOS, SAMPLE_GIT, SAMPLE_HOME, samplePayload } from "./sample.mjs";
import { collectSegments } from "./segments.mjs";
import { PreviewController, WIDTH_STEP } from "./tui-preview.mjs";
import {
  ACCENT,
  BAD,
  BOLD,
  MUTED,
  OK,
  RESET,
  TAB_CURRENT,
  TAB_ON,
  WARN,
  buildPopupOverlay,
  drawBottomBorder,
  drawRule,
  drawTopBorder,
  formatHints,
  frameRow,
  radioMark,
  renderBrand,
  renderThemeSwatches,
  styleAccent,
  styleBad,
  styleBold,
  styleMuted,
  styleOk,
} from "./tui-ui.mjs";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";

const PAGES = ["presets", "layout", "style"];
const STYLE_FIELDS = ["theme", "skin", "icons", "colorDepth", "contextFormat", "quotaPace", "dirStyle", "layout"];
const CARD_MIN = 34;
const CARD_LINES = 3;
const CARD_HEIGHT = CARD_LINES + 3;
const TOAST_MS = 4000;
const UNDO_LIMIT = 50;

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

export async function runEditor({
  preferences,
  stdin = process.stdin,
  stdout = process.stdout,
  onSave,
  language = "en",
  presetsDir = null,
  initialPage = "presets",
} = {}) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(editorStrings(language).needsTTY);
  }
  const session = new Session(normalizePreferences(preferences), {
    stdin,
    stdout,
    onSave,
    language,
    presetsDir,
    initialPage,
  });
  return session.run();
}

class Session {
  constructor(preferences, { stdin, stdout, onSave, language, presetsDir, initialPage }) {
    this.initialPreferences = preferences;
    this.preferences = preferences;
    this.stdin = stdin;
    this.stdout = stdout;
    this.onSave = onSave;
    this.language = language;
    this.strings = editorStrings(language);

    this.page = PAGES.includes(initialPage) ? initialPage : "presets";
    this.tabsFocused = true;

    this.library = new PresetLibrary(presetsDir);
    this.librarySeenGen = this.library.generation;
    this.presetFilter = 0;
    this.presetSelected = 0;
    this.presetScroll = 0;
    this.presetCols = 1;
    this.selectInitialPreset();

    this.styleField = 0;
    this.layoutSubmode = "list"; // "list" | "item"
    this.segment = 0;
    this.itemField = 0;
    this.textEdit = null;
    this.grab = null;
    this.savedCustomLayout = Array.isArray(preferences.layout) ? preferences.layout.map((row) => row.slice()) : null;

    this.preview = new PreviewController();
    this.undoStack = [];
    this.redoStack = [];
    this.toast = null;
    this.dialog = null;

    this.closed = false;
    this.busy = false;
    this.interrupted = false;
    this.error = "";
    this.onKeypress = (text, key) => this.handleKeypress(text, key).catch((error) => {
      this.closed = true;
      this.close();
      this.reject(error);
    });
  }

  selectInitialPreset() {
    const shown = this.shownPresets();
    const idx = shown.findIndex((entry) => isPresetInUse(this.preferences, entry));
    this.presetSelected = idx >= 0 ? idx : 0;
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

  showToast(text, bad = false) {
    this.toast = { text, bad, until: Date.now() + TOAST_MS };
  }

  dirty() {
    return JSON.stringify(this.preferences) !== JSON.stringify(this.initialPreferences);
  }

  commitPreferences(nextPrefs) {
    const normalized = normalizePreferences(nextPrefs);
    if (JSON.stringify(normalized) === JSON.stringify(this.preferences)) return;
    this.undoStack.push(this.preferences);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.preferences = normalized;
    this.error = "";
  }

  undo() {
    if (this.undoStack.length === 0) {
      this.showToast(this.strings.toasts.nothingToUndo);
      return;
    }
    this.redoStack.push(this.preferences);
    this.preferences = this.undoStack.pop();
    this.savedCustomLayout = Array.isArray(this.preferences.layout) ? this.preferences.layout.map((row) => row.slice()) : null;
    this.clampLayoutSelection();
    this.showToast(this.strings.toasts.undone);
  }

  redo() {
    if (this.redoStack.length === 0) {
      this.showToast(this.strings.toasts.nothingToRedo);
      return;
    }
    this.undoStack.push(this.preferences);
    this.preferences = this.redoStack.pop();
    this.savedCustomLayout = Array.isArray(this.preferences.layout) ? this.preferences.layout.map((row) => row.slice()) : null;
    this.clampLayoutSelection();
    this.showToast(this.strings.toasts.redone);
  }

  clampLayoutSelection() {
    const count = this.entries().length;
    this.segment = Math.max(0, Math.min(this.segment, Math.max(0, count - 1)));
    const id = this.selectedId();
    if (id && this.layoutSubmode === "item") {
      if (!this.activeIds().includes(id)) {
        this.layoutSubmode = "list";
        this.textEdit = null;
      } else {
        const controls = this.itemControls(id);
        this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));
      }
    }
  }

  async handleKeypress(text, key) {
    if (this.busy || this.closed) return;
    if (key?.ctrl && key.name === "c") {
      this.finish(false);
      return;
    }
    if (key?.ctrl && key.name === "s") {
      this.textEdit = null;
      this.dialog = null;
      await this.save();
      return;
    }

    if (this.dialog) {
      const pending = this.handleDialogKey(text, key);
      if (pending && typeof pending.then === "function") {
        await pending;
        return;
      }
      if (!this.closed) this.draw();
      return;
    }

    if (this.page === "layout" && this.layoutSubmode === "item" && this.textEdit) {
      this.handleTextEdit(text, key);
      if (!this.closed) this.draw();
      return;
    }

    if (key?.ctrl && key.name === "z") {
      this.undo();
      if (!this.closed) this.draw();
      return;
    }
    if (key?.ctrl && key.name === "y") {
      this.redo();
      if (!this.closed) this.draw();
      return;
    }
    if (key?.ctrl && key.name === "p") {
      this.openCommandsDialog();
      if (!this.closed) this.draw();
      return;
    }

    const action = keyAction(text, key);
    if (action === "cancel") {
      this.finish(false);
      return;
    }

    if (this.tabsFocused) {
      const handled = this.handleTabBarKey(text, key, action);
      if (!handled) this.handleGlobalKey(text, action);
      if (!this.closed) this.draw();
      return;
    }

    let handled = false;
    if (this.page === "presets") handled = this.handlePresetsKey(text, key, action);
    else if (this.page === "layout") handled = this.handleLayoutKey(text, key, action);
    else if (this.page === "style") handled = this.handleStyleKey(text, key, action);

    if (!handled) {
      this.handleGlobalKey(text, action);
    }
    if (!this.closed) this.draw();
  }

  handleGlobalKey(text, action) {
    if (text === "?" || action === "help") {
      this.dialog = { kind: "help" };
      return true;
    }
    if (text === "[") {
      this.preview.nextScenario(-1);
      return true;
    }
    if (text === "]") {
      this.preview.nextScenario(1);
      return true;
    }
    if (text === "-") {
      this.preview.resize(-WIDTH_STEP);
      return true;
    }
    if (text === "+" || text === "=") {
      this.preview.resize(WIDTH_STEP);
      return true;
    }
    if (text === "{") {
      this.preview.cycleDepth();
      return true;
    }
    if (text === "}") {
      this.preview.cycleGlyphs();
      return true;
    }
    return false;
  }

  handleTabBarKey(text, key, action) {
    if (action === "back") {
      this.finish(false);
      return true;
    }
    if (key?.name === "left" || text === "h") {
      this.stepPage(-1);
      return true;
    }
    if (key?.name === "right" || text === "l") {
      this.stepPage(1);
      return true;
    }
    if (key?.name === "down" || text === "j" || action === "confirm") {
      this.tabsFocused = false;
      return true;
    }
    return false;
  }

  stepPage(delta) {
    const idx = PAGES.indexOf(this.page);
    this.page = PAGES[(idx + delta + PAGES.length) % PAGES.length];
    this.layoutSubmode = "list";
    this.textEdit = null;
    this.grab = null;
  }

  // ── Presets Page ──────────────────────────────────────────────────────────

  shownPresets() {
    this.followLibrary();
    return this.library.filtered(PRESET_FILTERS[this.presetFilter]);
  }

  followLibrary() {
    if (this.library.generation === this.librarySeenGen) return;
    this.librarySeenGen = this.library.generation;
    const name = this.library.lastChanged;
    if (!name) return;
    let shown = this.library.filtered(PRESET_FILTERS[this.presetFilter]);
    if (!shown.some((entry) => entry.name === name)) {
      this.presetFilter = 0;
      shown = this.library.filtered("all");
    }
    const idx = shown.findIndex((entry) => entry.name === name);
    if (idx >= 0) this.presetSelected = idx;
  }

  handlePresetsKey(text, key, action) {
    const shown = this.shownPresets();
    const count = shown.length;
    const cols = Math.max(1, this.presetCols);
    this.presetSelected = Math.max(0, Math.min(this.presetSelected, Math.max(0, count - 1)));

    if (key?.name === "tab") {
      const k = PRESET_FILTERS.length;
      const delta = key.shift ? k - 1 : 1;
      this.presetFilter = (this.presetFilter + delta) % k;
      this.presetSelected = 0;
      this.presetScroll = 0;
      return true;
    }
    if (action === "back") {
      this.tabsFocused = true;
      return true;
    }
    if (key?.name === "left") {
      if (this.presetSelected % cols !== 0) this.presetSelected -= 1;
      return true;
    }
    if (key?.name === "right") {
      if ((this.presetSelected % cols) + 1 < cols && this.presetSelected + 1 < count) {
        this.presetSelected += 1;
      }
      return true;
    }
    if (key?.name === "up") {
      if (this.presetSelected < cols) {
        this.tabsFocused = true;
      } else {
        this.presetSelected -= cols;
      }
      return true;
    }
    if (key?.name === "down") {
      if (this.presetSelected + cols < count) {
        this.presetSelected += cols;
      } else if (Math.floor(this.presetSelected / cols) < Math.floor(Math.max(0, count - 1) / cols)) {
        this.presetSelected = count - 1;
      }
      return true;
    }

    const lower = typeof text === "string" ? text.toLowerCase() : "";
    if ((action === "confirm" || lower === "l" || lower === "s") && count > 0) {
      const entry = shown[this.presetSelected];
      if (!entry.preferences) {
        this.showToast(this.strings.toasts.cantUsePreset(entry.name, entry.error), true);
        return true;
      }
      const part = action === "confirm" ? "all" : lower === "l" ? "layout" : "style";
      this.commitPreferences(applyPreset(this.preferences, entry, part));
      this.savedCustomLayout = Array.isArray(this.preferences.layout) ? this.preferences.layout.map((row) => row.slice()) : null;
      this.segment = 0;
      const msg = part === "all"
        ? this.strings.toasts.appliedAll(entry.name)
        : part === "layout"
          ? this.strings.toasts.appliedLayout(entry.name)
          : this.strings.toasts.appliedStyle(entry.name);
      this.showToast(msg);
      return true;
    }

    if (lower === "n") {
      this.dialog = {
        kind: "preset-form",
        mode: "create",
        originalName: null,
        focus: 0,
        name: "",
        summary: "",
        error: "",
      };
      return true;
    }

    if ((lower === "w" || lower === "e" || lower === "x" || key?.name === "delete") && count > 0) {
      const entry = shown[this.presetSelected];
      if (entry.origin !== "mine") {
        this.showToast(this.strings.toasts.builtinImmutable);
        return true;
      }
      if (lower === "w") {
        this.dialog = { kind: "preset-confirm", mode: "replace", name: entry.name };
      } else if (lower === "e") {
        this.dialog = {
          kind: "preset-form",
          mode: "rename",
          originalName: entry.name,
          focus: 0,
          name: entry.name,
          summary: entry.summary[this.language] ?? entry.summary.en ?? "",
          error: "",
        };
      } else {
        this.dialog = { kind: "preset-confirm", mode: "delete", name: entry.name };
      }
      return true;
    }

    return false;
  }

  // ── Layout Page & Item Editor ─────────────────────────────────────────────

  handleLayoutKey(text, key, action) {
    if (this.layoutSubmode === "item") {
      return this.handleItemKey(key, action);
    }

    if (action === "back") {
      if (this.grab) this.restoreGrab();
      else this.tabsFocused = true;
      return true;
    }
    if (action === "confirm") {
      if (this.grab) this.grab = null;
      else if (this.activeIds().includes(this.selectedId())) this.pickup();
      return true;
    }
    if (action === "up") {
      if (this.grab) {
        this.moveGrabbed(-1);
        return true;
      }
      if (this.segment === 0) {
        this.tabsFocused = true;
      } else {
        this.moveSelection(-1);
      }
      return true;
    }
    if (action === "down") {
      if (this.grab) this.moveGrabbed(1);
      else this.moveSelection(1);
      return true;
    }
    if (action === "toggle" && !this.grab) {
      this.toggleSelected();
      return true;
    }
    if (action === "break" && !this.grab && this.activeIds().includes(this.selectedId())) {
      this.toggleBreakSelected();
      return true;
    }
    if (action === "align" && !this.grab && this.activeIds().includes(this.selectedId())) {
      this.toggleAlignSelected();
      return true;
    }
    if (action === "reset" && !this.grab) {
      this.resetLayout();
      return true;
    }
    if (text === "m" && !this.grab) {
      this.cycleLayoutMode(1);
      return true;
    }
    if ((action === "edit" || action === "right") && !this.grab && this.activeIds().includes(this.selectedId())) {
      this.openItem();
      return true;
    }
    return false;
  }

  openItem() {
    this.layoutSubmode = "item";
    this.itemField = 0;
    this.textEdit = null;
  }

  handleItemKey(key, action) {
    const id = this.selectedId();
    const controls = this.itemControls(id);
    this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));
    const prop = controls[this.itemField];
    if (action === "back") {
      this.layoutSubmode = "list";
      this.textEdit = null;
      return true;
    }
    if (action === "up") {
      this.itemField = (this.itemField - 1 + controls.length) % controls.length;
      return true;
    }
    if (action === "down") {
      this.itemField = (this.itemField + 1) % controls.length;
      return true;
    }
    if (action === "left") {
      this.cycleItemProp(id, prop, -1);
      return true;
    }
    if (action === "right") {
      this.cycleItemProp(id, prop, 1);
      return true;
    }
    if (action === "reset") {
      this.setItemProp(id, prop, undefined);
      return true;
    }
    if (action === "confirm") {
      if (prop === "widget") {
        this.cycleItemProp(id, prop, 1);
      } else {
        const current = this.preferences.items?.[id]?.[prop] ?? (prop === "icon" ? this.resolvedIcon(id) : this.resolvedFormat(id));
        this.textEdit = { prop, value: current, original: this.preferences };
      }
      return true;
    }
    return false;
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
      const latest = this.preferences;
      if (JSON.stringify(latest) !== JSON.stringify(edit.original)) {
        this.undoStack.push(edit.original);
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
        this.redoStack = [];
      }
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
      this.setItemProp(id, "format", trimmed ? trimmed : undefined, { recordUndo: false });
    } else {
      this.setItemProp(id, "icon", value, { recordUndo: false });
    }
  }

  // ── Style Page ────────────────────────────────────────────────────────────

  handleStyleKey(text, key, action) {
    if (action === "back") {
      this.tabsFocused = true;
      return true;
    }
    if (action === "up") {
      if (this.styleField === 0) this.tabsFocused = true;
      else this.styleField -= 1;
      return true;
    }
    if (action === "down") {
      if (this.styleField + 1 < STYLE_FIELDS.length) this.styleField += 1;
      return true;
    }
    if (action === "left") {
      this.changeStyleField(-1);
      return true;
    }
    if (action === "right" || action === "confirm" || action === "toggle") {
      this.changeStyleField(1);
      return true;
    }
    return false;
  }

  changeStyleField(delta) {
    const field = STYLE_FIELDS[this.styleField];
    if (field === "layout") {
      this.cycleLayoutMode(delta);
      return;
    }
    const names = namesFor(field);
    const current = this.preferences[field];
    const index = Math.max(0, names.indexOf(current));
    const next = names[(index + delta + names.length) % names.length];
    this.commitPreferences({ ...this.preferences, [field]: next });
  }

  cycleLayoutMode(delta) {
    const modes = presetHasStructuredLayout(this.preferences.preset)
      ? ["flat", "preset", "custom"]
      : ["flat", "custom"];
    const current = layoutModeOf(this.preferences);
    const index = Math.max(0, modes.indexOf(current));
    const next = modes[(index + delta + modes.length) % modes.length];
    if (next === "flat") {
      this.commitPreferences({ ...this.preferences, layout: "flat" });
    } else if (next === "preset") {
      this.commitPreferences({ ...this.preferences, layout: "preset" });
    } else {
      const validSaved = Array.isArray(this.savedCustomLayout)
        && this.savedCustomLayout.flat().reduce((total, count) => total + count, 0) === this.preferences.segments.length;
      const counts = validSaved ? this.savedCustomLayout : seedCustomLayout(this.preferences);
      this.savedCustomLayout = counts.map((row) => row.slice());
      this.commitPreferences({ ...this.preferences, layout: counts });
    }
  }

  // ── Modal Dialogs ─────────────────────────────────────────────────────────

  openCommandsDialog() {
    this.dialog = {
      kind: "commands",
      query: "",
      selected: 0,
    };
  }

  commandItems() {
    const zh = this.language === "zh";
    const items = [
      { id: "page:presets", label: zh ? "切换到 预设 页面" : "Go to Presets page", run: () => { this.page = "presets"; this.tabsFocused = false; } },
      { id: "page:layout", label: zh ? "切换到 布局 页面" : "Go to Layout page", run: () => { this.page = "layout"; this.layoutSubmode = "list"; this.tabsFocused = false; } },
      { id: "page:style", label: zh ? "切换到 样式 页面" : "Go to Style page", run: () => { this.page = "style"; this.tabsFocused = false; } },
      {
        id: "preset:new",
        label: zh ? "将当前配置保存为新预设 (N)" : "Save current setup as preset (N)",
        run: () => {
          this.dialog = { kind: "preset-form", mode: "create", originalName: null, focus: 0, name: "", summary: "", error: "" };
          return "keep-dialog";
        },
      },
      { id: "edit:undo", label: zh ? "撤销上一步修改 (^Z)" : "Undo last change (^Z)", run: () => this.undo() },
      { id: "edit:redo", label: zh ? "重做修改 (^Y)" : "Redo change (^Y)", run: () => this.redo() },
      { id: "file:save", label: zh ? "保存配置并退出 (^S)" : "Save and quit (^S)", run: async () => this.save() },
      { id: "file:quit", label: zh ? "放弃修改并退出 (q)" : "Cancel and quit (q)", run: () => this.finish(false) },
    ];
    for (const entry of this.library.entries()) {
      if (!entry.preferences) continue;
      items.push({
        id: `apply:${entry.name}`,
        label: zh ? `应用预设：${entry.title}` : `Apply preset: ${entry.title}`,
        run: () => {
          this.commitPreferences(applyPreset(this.preferences, entry, "all"));
          this.savedCustomLayout = Array.isArray(this.preferences.layout) ? this.preferences.layout.map((row) => row.slice()) : null;
          this.showToast(this.strings.toasts.appliedAll(entry.name));
        },
      });
    }
    for (const scenario of PREVIEW_SCENARIOS) {
      items.push({
        id: `scenario:${scenario.name}`,
        label: zh ? `预览场景：${scenario.name}` : `Preview scenario: ${scenario.name}`,
        run: () => this.preview.selectScenario(scenario.name),
      });
    }
    return items;
  }

  handleDialogKey(text, key) {
    const d = this.dialog;
    if (d.kind === "help") {
      if (key?.name === "escape" || key?.name === "return" || key?.name === "enter" || text === "?" || text === "q") {
        this.dialog = null;
      }
      return;
    }

    if (d.kind === "preset-confirm") {
      const lower = typeof text === "string" ? text.toLowerCase() : "";
      if (key?.name === "escape" || lower === "n") {
        this.dialog = null;
        return;
      }
      if (lower === "y" || key?.name === "return" || key?.name === "enter") {
        if (d.mode === "replace") {
          const res = this.library.replace(d.name, this.preferences, { language: this.language });
          if (res.ok) {
            this.preferences = normalizePreferences({ ...this.preferences, customPreset: res.name });
            this.showToast(this.strings.toasts.replacedPreset(res.name));
          } else {
            this.showToast(res.error, true);
          }
        } else if (d.mode === "delete") {
          const wasActive = this.preferences.customPreset === d.name;
          const res = this.library.delete(d.name, { language: this.language });
          if (res.ok) {
            if (wasActive) {
              const { customPreset: _drop, ...rest } = this.preferences;
              this.preferences = normalizePreferences(rest);
            }
            this.showToast(this.strings.toasts.deletedPreset(d.name));
          } else {
            this.showToast(res.error, true);
          }
        }
        this.dialog = null;
      }
      return;
    }

    if (d.kind === "preset-form") {
      if (key?.name === "escape") {
        this.dialog = null;
        return;
      }
      if (key?.name === "tab" || key?.name === "up" || key?.name === "down") {
        d.focus = 1 - d.focus;
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        const res = d.mode === "create"
          ? this.library.create(d.name, d.summary, this.preferences, { language: this.language })
          : this.library.rename(d.originalName, d.name, d.summary, { language: this.language });
        if (!res.ok) {
          d.error = res.error;
          return;
        }
        if (d.mode === "create" || this.preferences.customPreset === d.originalName) {
          this.preferences = normalizePreferences({ ...this.preferences, customPreset: res.name });
        }
        this.dialog = null;
        this.showToast(
          d.mode === "create"
            ? this.strings.toasts.savedPreset(res.name)
            : this.strings.toasts.renamedPreset(d.originalName, res.name),
        );
        return;
      }
      const field = d.focus === 0 ? "name" : "summary";
      if (key?.name === "backspace") {
        d[field] = [...d[field]].slice(0, -1).join("");
        d.error = "";
        return;
      }
      if (typeof text === "string" && text.length > 0 && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        const limit = field === "name" ? 32 : 80;
        d[field] = [...d[field], ...sanitizeText(text)].slice(0, limit).join("");
        d.error = "";
      }
      return;
    }

    if (d.kind === "commands") {
      const all = this.commandItems();
      const q = d.query.trim().toLowerCase();
      const matched = q ? all.filter((item) => item.label.toLowerCase().includes(q) || item.id.includes(q)) : all;
      if (key?.name === "escape") {
        this.dialog = null;
        return;
      }
      if (key?.name === "up") {
        if (matched.length) d.selected = (d.selected - 1 + matched.length) % matched.length;
        return;
      }
      if (key?.name === "down") {
        if (matched.length) d.selected = (d.selected + 1) % matched.length;
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        const chosen = matched[d.selected];
        if (!chosen) return;
        this.dialog = null;
        return chosen.run();
      }
      if (key?.name === "backspace") {
        d.query = [...d.query].slice(0, -1).join("");
        d.selected = 0;
        return;
      }
      if (typeof text === "string" && text.length > 0 && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        d.query = [...d.query, ...sanitizeText(text)].slice(0, 40).join("");
        d.selected = 0;
      }
    }
  }

  // ── Shared Layout & Item Mutations ────────────────────────────────────────

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
      ...this.widgetChoices(id).filter((w) => w !== defaultWidget || w === currentWidget),
    ];
    const choices = prop === "widget" ? widgetCycle
      : prop === "icon" ? this.iconChoices(id)
      : this.formatChoices(id);
    const current = this.preferences.items?.[id]?.[prop];
    const index = Math.max(0, choices.indexOf(current));
    const next = choices[(index + delta + choices.length) % choices.length];
    this.setItemProp(id, prop, next);
  }

  setItemProp(id, prop, value, { recordUndo = true } = {}) {
    const items = { ...(this.preferences.items ?? {}) };
    const entry = { ...(items[id] ?? {}) };
    if (value === undefined) delete entry[prop];
    else entry[prop] = value;
    if (Object.keys(entry).length === 0) delete items[id];
    else items[id] = entry;
    const next = { ...this.preferences };
    if (Object.keys(items).length > 0) next.items = items;
    else delete next.items;
    if (recordUndo) {
      this.commitPreferences(next);
    } else {
      this.preferences = normalizePreferences(next);
    }
    const controls = this.itemControls(id);
    this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));
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

  toggleBreakSelected() {
    const id = this.selectedId();
    if (!id) return;
    const rows = cloneRows(this.preferences);
    const found = findInRows(rows, id);
    if (!found) return;
    const { rowIndex, side, itemIndex } = found;
    const row = rows[rowIndex];
    const posInRow = side === "left" ? itemIndex : row.left.length + itemIndex;
    if (posInRow > 0) {
      const upper = side === "left"
        ? { left: row.left.slice(0, itemIndex), right: [] }
        : { left: row.left.slice(), right: row.right.slice(0, itemIndex) };
      const lower = side === "left"
        ? { left: row.left.slice(itemIndex), right: row.right.slice() }
        : { left: row.right.slice(itemIndex), right: [] };
      rows.splice(rowIndex, 1, upper, lower);
      this.commitCustomRows(rows);
    } else if (rowIndex > 0) {
      const prev = rows[rowIndex - 1];
      const curr = rows[rowIndex];
      const merged = { left: [...prev.left, ...prev.right, ...curr.left], right: [...curr.right] };
      rows.splice(rowIndex - 1, 2, merged);
      this.commitCustomRows(rows);
    }
    this.selectId(id);
  }

  toggleAlignSelected() {
    const id = this.selectedId();
    if (!id) return;
    const rows = cloneRows(this.preferences);
    const found = findInRows(rows, id);
    if (!found) return;
    const row = rows[found.rowIndex];
    if (found.side === "left") {
      const [item] = row.left.splice(found.itemIndex, 1);
      row.right.push(item);
    } else {
      const [item] = row.right.splice(found.itemIndex, 1);
      row.left.push(item);
    }
    this.commitCustomRows(rows);
    this.selectId(id);
  }

  resetLayout() {
    const id = this.selectedId();
    if (presetHasStructuredLayout(this.preferences.preset) && layoutModeOf(this.preferences) !== "preset") {
      this.commitPreferences({ ...this.preferences, layout: "preset" });
    } else {
      this.savedCustomLayout = null;
      this.commitPreferences({ ...this.preferences, layout: "flat" });
    }
    if (id) this.selectId(id);
  }

  commitRows(rows) {
    const nonEmpty = rows.filter((row) => row.left.length || row.right.length);
    const segments = nonEmpty.flatMap((row) => [...row.left, ...row.right].map((item) => item.metric));
    const counts = nonEmpty.map((row) => [row.left.length, row.right.length]);
    const structured = this.preferences.layout && this.preferences.layout !== "flat";
    const singleLeftOnly = counts.length <= 1 && (counts[0]?.[1] ?? 0) === 0;
    const layout = structured && !singleLeftOnly ? counts : "flat";
    if (Array.isArray(layout)) this.savedCustomLayout = layout.map((row) => row.slice());
    this.commitPreferences({ ...this.preferences, segments, layout });
  }

  commitCustomRows(rows) {
    const nonEmpty = rows.filter((row) => row.left.length || row.right.length);
    const segments = nonEmpty.flatMap((row) => [...row.left, ...row.right].map((item) => item.metric));
    const counts = nonEmpty.map((row) => [row.left.length, row.right.length]);
    const singleLeftOnly = counts.length <= 1 && (counts[0]?.[1] ?? 0) === 0;
    const layout = singleLeftOnly ? "flat" : counts;
    this.savedCustomLayout = Array.isArray(layout) ? layout.map((row) => row.slice()) : null;
    this.commitPreferences({ ...this.preferences, segments, layout });
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

  // ── Rendering ─────────────────────────────────────────────────────────────

  draw() {
    if (this.closed) return;
    const columns = this.stdout.columns || 80;
    const rows = this.stdout.rows || 24;

    if (rows === 1) {
      this.stdout.write(CLEAR + clip(this.styleFieldLine(STYLE_FIELDS[this.styleField], true, false), columns));
      return;
    }
    if (columns < 40 || rows < 10) {
      const msg = this.language === "zh"
        ? `窗口过小 (${columns}×${rows})，请至少放大到 40×10。`
        : `Terminal too small (${columns}×${rows}); need at least 40×10.`;
      const lines = [clip(msg, columns)];
      while (lines.length < rows - 1) lines.push("");
      lines.push(clip(this.strings.shortFooter, columns));
      this.stdout.write(CLEAR + lines.join("\n"));
      return;
    }

    const innerW = columns - 2;
    this.preview.fit = innerW;

    // Determine what the shared bottom preview bar displays
    let previewPrefs = this.preferences;
    let showingLabel = null;
    if (this.page === "presets" && !this.tabsFocused) {
      const shown = this.shownPresets();
      const hovered = shown[this.presetSelected];
      if (hovered?.preferences) {
        previewPrefs = hovered.preferences;
        showingLabel = `${hovered.name} · ${this.strings.enterApplies}`;
      }
    }

    const previewCols = this.preview.columns();
    const rawPreviewLines = this.preview.render(previewPrefs, previewCols, {
      emptyText: this.strings.noSegments,
    });

    // Fixed chrome: top border(1) + tab bar(1) + rule(1) + ...body... + preview rule(1) + preview lines + ruler(1) + footer rule(1) + footer(1) + bottom border(1)
    const minBody = this.page === "presets" ? 8 : 6;
    const fixedWithoutPreview = 7;
    const maxPreviewRoom = Math.max(1, rows - fixedWithoutPreview - minBody - 2);
    const previewLines = rawPreviewLines.slice(0, Math.min(rawPreviewLines.length, maxPreviewRoom));
    const bodyRows = Math.max(1, rows - fixedWithoutPreview - (previewLines.length + 2));

    let bodyLines;
    if (this.page === "presets") bodyLines = this.renderPresetsBody(innerW, bodyRows, columns);
    else if (this.page === "layout") bodyLines = this.renderLayoutBody(innerW, bodyRows, columns);
    else bodyLines = this.renderStyleBody(innerW, bodyRows, columns);

    while (bodyLines.length < bodyRows) bodyLines.push(frameRow("", innerW, columns));
    if (bodyLines.length > bodyRows) bodyLines = bodyLines.slice(0, bodyRows);

    const star = this.dirty() ? `${WARN}* ${RESET}` : "";
    const topRightTitle = ` statusline.json ${star}`;
    const tabRow = frameRow(this.tabLine(innerW), innerW, columns);
    const previewHeading = this.preview.title(previewPrefs, {
      showing: showingLabel,
      room: Math.max(10, columns - 6),
      language: this.language,
    });
    const previewBodyRows = previewLines.map((line) => frameRow(line, innerW, columns));
    const rulerRow = frameRow(this.preview.ruler(previewCols), innerW, columns);
    const footerRow = frameRow(this.footerContent(innerW), innerW, columns);

    const frame = [
      drawTopBorder(columns, topRightTitle),
      tabRow,
      drawRule(columns),
      ...bodyLines,
      drawRule(columns, previewHeading),
      ...previewBodyRows,
      rulerRow,
      drawRule(columns),
      footerRow,
      drawBottomBorder(columns),
    ].join("\n");

    const overlay = this.dialog ? this.renderDialogOverlay(columns, rows) : "";
    this.stdout.write(CLEAR + frame + overlay);
  }

  tabLine(innerW) {
    const depth = colorDepth("auto", { enabled: true });
    const brand = ` ${renderBrand("agy-statusline", depth)}`;
    const brandW = visibleWidth(brand);

    const tabChunks = PAGES.map((pageId, index) => {
      const label = ` ${this.strings.tabs[pageId]} `;
      const styled = pageId === this.page
        ? `${this.tabsFocused ? TAB_ON : TAB_CURRENT}${label}${RESET}`
        : label;
      return index > 0 ? ` ${styled}` : styled;
    }).join("");
    const tabsW = visibleWidth(tabChunks);

    const start = Math.max(brandW + 2, Math.floor((innerW - tabsW) / 2));
    const gap = Math.max(1, start - brandW);
    return `${brand}${" ".repeat(gap)}${tabChunks}`;
  }

  renderPresetsBody(innerW, bodyRows, columns) {
    const shown = this.shownPresets();
    this.presetSelected = Math.max(0, Math.min(this.presetSelected, Math.max(0, shown.length - 1)));
    const currentEntry = shown[this.presetSelected] ?? null;

    // Filter line (1 row) + grid (remaining - 2 rows) + info bar (2 rows)
    const filterLine = this.renderFilterLine();
    const infoLines = this.renderPresetInfo(currentEntry);
    const gridRows = Math.max(CARD_HEIGHT, bodyRows - 1 - infoLines.length);

    const cols = Math.max(1, Math.floor(innerW / CARD_MIN));
    this.presetCols = cols;
    const visibleCardRows = Math.max(1, Math.floor(gridRows / CARD_HEIGHT));
    const selectedRow = Math.floor(this.presetSelected / cols);
    if (selectedRow < this.presetScroll) {
      this.presetScroll = selectedRow;
    } else if (selectedRow >= this.presetScroll + visibleCardRows) {
      this.presetScroll = selectedRow + 1 - visibleCardRows;
    }

    const lines = [frameRow(filterLine, innerW, columns)];

    if (shown.length === 0) {
      const emptyMsg = PRESET_FILTERS[this.presetFilter] === "mine"
        ? this.strings.emptyMinePresets
        : this.strings.emptyFilterPresets;
      lines.push(frameRow(` ${styleMuted(emptyMsg)}`, innerW, columns));
      for (let i = 1; i < gridRows; i += 1) {
        lines.push(frameRow("", innerW, columns));
      }
    } else {
      const cardWidth = Math.floor(innerW / cols);
      const renderedCards = new Map();
      const firstIdx = this.presetScroll * cols;
      const lastIdx = Math.min(shown.length, firstIdx + visibleCardRows * cols);
      for (let i = firstIdx; i < lastIdx; i += 1) {
        const c = i % cols;
        const w = c + 1 === cols ? innerW - c * cardWidth : cardWidth - 1;
        const startCol = 2 + c * cardWidth;
        const focused = !this.tabsFocused && i === this.presetSelected;
        renderedCards.set(i, this.renderCardLines(shown[i], w, focused, startCol));
      }

      for (let r = 0; r < visibleCardRows; r += 1) {
        const rowBase = (this.presetScroll + r) * cols;
        if (rowBase >= shown.length) {
          for (let y = 0; y < CARD_HEIGHT; y += 1) lines.push(frameRow("", innerW, columns));
          continue;
        }
        for (let y = 0; y < CARD_HEIGHT; y += 1) {
          let rowContent = "";
          let usedW = 0;
          for (let c = 0; c < cols; c += 1) {
            const idx = rowBase + c;
            if (idx >= shown.length) break;
            const offset = c * cardWidth;
            if (offset > usedW) {
              rowContent += " ".repeat(offset - usedW);
              usedW = offset;
            }
            const w = c + 1 === cols ? innerW - offset : cardWidth - 1;
            const startCol = 2 + offset;
            const cardLine = renderedCards.get(idx)[y];
            rowContent += `\x1b[${startCol}G${cardLine}`;
            usedW = offset + w;
          }
          if (innerW > usedW) rowContent += " ".repeat(innerW - usedW);
          lines.push(`${MUTED}│${RESET}${rowContent}\x1b[${columns}G${MUTED}│${RESET}`);
        }
      }
      while (lines.length < 1 + gridRows) {
        lines.push(frameRow("", innerW, columns));
      }
    }

    for (const info of infoLines) {
      lines.push(frameRow(info, innerW, columns));
    }
    return lines;
  }

  renderFilterLine() {
    const parts = [` ${styleMuted(this.strings.filterLabel)}  `];
    PRESET_FILTERS.forEach((id, index) => {
      const on = index === this.presetFilter;
      const label = this.strings.filters[id] ?? id;
      const chunk = `${radioMark(on)} ${label}  `;
      parts.push(on ? styleAccent(chunk) : chunk);
    });
    return parts.join("");
  }

  renderCardLines(entry, width, focused, startCol = 2) {
    const innerCardW = Math.max(1, width - 2);
    const rightCol = startCol + width - 1;
    const border = focused
      ? { color: ACCENT, tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" }
      : { color: MUTED, tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
    const snapRight = (glyph) => `\x1b[${rightCol}G${border.color}${glyph}${RESET}`;
    const inUse = isPresetInUse(this.preferences, entry);
    const exactMatch = inUse && matchesPreset(this.preferences, entry);

    const titleChunk = ` ${entry.title} `;
    const rawBadge = inUse
      ? ` ✓ ${exactMatch ? this.strings.inUse : this.strings.inUseModified} `
      : "";
    const badgeText = rawBadge
      ? fitAnsi(rawBadge, Math.min(visibleWidth(rawBadge), Math.max(0, innerCardW - 3)), { ellipsis: true })
      : "";
    const badgeW = visibleWidth(badgeText);
    const maxTitleW = Math.max(0, innerCardW - 2 - badgeW);
    const fittedTitle = maxTitleW > 0
      ? fitAnsi(styleBold(titleChunk), Math.min(visibleWidth(titleChunk), maxTitleW), { ellipsis: true })
      : "";
    const titleW = visibleWidth(fittedTitle);
    const topFill = Math.max(0, innerCardW - 1 - titleW - badgeW);
    const topBorder = `${border.color}${border.tl}${border.h}${RESET}${fittedTitle}${border.color}${border.h.repeat(topFill)}${RESET}${badgeText ? styleOk(badgeText) : ""}${snapRight(border.tr)}`;

    let bodyLines;
    if (entry.error) {
      bodyLines = [
        styleBad(this.strings.cantReadPreset),
        styleMuted(entry.error),
      ];
    } else {
      bodyLines = this.preview.render(entry.preferences, innerCardW, {
        maxLines: CARD_LINES,
        emptyText: this.strings.noSegments,
      });
    }
    while (bodyLines.length < CARD_LINES) bodyLines.push("");
    bodyLines = bodyLines.slice(0, CARD_LINES);

    const footerText = this.presetCardFooter(entry);
    const wrapRow = (content) => {
      const fitted = fitAnsi(content, innerCardW, { ellipsis: true });
      return `${border.color}${border.v}${RESET}${fitted}${snapRight(border.v)}`;
    };

    return [
      topBorder,
      ...bodyLines.map(wrapRow),
      wrapRow(styleMuted(footerText)),
      `${border.color}${border.bl}${border.h.repeat(innerCardW)}${snapRight(border.br)}`,
    ];
  }

  presetCardFooter(entry) {
    const lineCount = entry.preferences ? presetRows(entry.preferences).length : null;
    const lineText = lineCount != null ? this.strings.lineWord(lineCount) : null;
    if (entry.origin === "mine") {
      const edited = formatEditedAgo(entry.mtimeMs, Date.now(), this.language);
      return [this.strings.mineTag, lineText, edited].filter(Boolean).join(" · ");
    }
    return [lineText, ...entry.tags.map((tag) => this.strings.filters[tag] ?? tag)].filter(Boolean).join(" · ");
  }

  renderPresetInfo(entry) {
    if (!entry) return [""];
    const summaryText = entry.summary[this.language] || entry.summary.en || "";
    const summary = summaryText
      ? `— ${summaryText}`
      : styleMuted(`— ${this.strings.yourPresetSummary}`);
    const row1 = ` ${styleBold(entry.title)} ${summary}`;
    let row2;
    if (entry.error) {
      row2 = ` ${styleBad(entry.error)}`;
    } else {
      const prefs = entry.preferences;
      const linesText = this.strings.lineWord(presetRows(prefs).length);
      row2 = ` ${styleMuted(this.strings.presetMetaLine(linesText, prefs.skin, prefs.theme, prefs.icons))}`;
    }
    return [row1, row2];
  }

  renderLayoutBody(innerW, bodyRows, columns) {
    if (this.layoutSubmode === "item") {
      return this.renderItemBody(innerW, bodyRows, columns);
    }
    const strings = this.strings;
    const modeLabel = this.formatLayoutModeValue();
    const header = [
      ` ${styleBold(strings.layoutTitle)}  ${styleMuted(`${strings.layoutModeLabel}:`)} ${styleAccent(modeLabel)}`,
      ` ${styleMuted(this.grab ? strings.grabbedKeys : strings.layoutKeys)}`,
    ];

    const room = Math.max(1, bodyRows - header.length);
    const entries = this.entries();
    const activeCount = this.activeIds().length;
    const slots = placement(this.preferences);
    const isFlat = layoutModeOf(this.preferences) === "flat";
    const displayItems = [];
    let lastRow = -1;
    let addedDisabledHeader = false;
    entries.forEach((segment, entryIndex) => {
      const enabled = entryIndex < activeCount;
      const where = slots.get(segment.id);
      if (enabled && where) {
        if (where.row !== lastRow) {
          lastRow = where.row;
          displayItems.push({ kind: "header", text: `  ${dim(strings.rowHeader(where.row + 1, isFlat))}` });
        }
      } else if (!enabled && !addedDisabledHeader) {
        addedDisabledHeader = true;
        displayItems.push({ kind: "header", text: `  ${dim(strings.disabledHeader)}` });
      }
      const [label] = segmentText(segment, this.language);
      const custom = this.preferences.items?.[segment.id] ? ` · ${strings.customTag}` : "";
      const treeTag = enabled && segment.id === "subagents" && this.effectiveWidget("subagents") === "tree"
        ? ` · ${strings.treeBottomTag}`
        : "";
      const place = where ? `${strings.rowSide(where.row + 1, where.side)}${custom}${treeTag}` : strings.disabled;
      const state = this.grab?.id === segment.id ? strings.grabbed : enabled ? strings.enabled : strings.off;
      const isSelected = !this.tabsFocused && entryIndex === this.segment;
      const cursor = isSelected ? styleAccent(">") : " ";
      displayItems.push({
        kind: "entry",
        entryIndex,
        text: `${cursor} ${padVisible(label, 14)} ${padVisible(state, 8)} ${dim(place)}`,
      });
    });

    const cursorDisplayIndex = Math.max(
      0,
      displayItems.findIndex((item) => item.kind === "entry" && item.entryIndex === this.segment),
    );
    let start = Math.max(0, Math.min(cursorDisplayIndex - Math.floor((room - 1) / 2), displayItems.length - room));
    if (room >= 2 && start > 0 && start === cursorDisplayIndex && displayItems[cursorDisplayIndex - 1]?.kind === "header") {
      start -= 1;
    }
    const visible = displayItems.slice(start, start + room).map((item) => item.text);
    return [...header, ...visible].map((line) => frameRow(line, innerW, columns));
  }

  renderItemBody(innerW, bodyRows, columns) {
    const strings = this.strings;
    const id = this.selectedId();
    const segment = SEGMENT_REGISTRY.find((entry) => entry.id === id) ?? { id, label: id };
    const [label] = segmentText(segment, this.language);
    const controls = this.itemControls(id);
    this.itemField = Math.max(0, Math.min(this.itemField, controls.length - 1));

    const header = [` ${title(strings.itemTitle(label))}`];
    const blockLines = this.segmentPreviewLines(id);
    const blockPrefix = `  ${dim(strings.itemPreview)} `;
    const blockIndent = " ".repeat(visibleWidth(blockPrefix));
    const blockLine = blockLines.length && bodyRows >= 5
      ? blockLines.slice(0, bodyRows >= 10 ? 2 : 1).map((line, index) => `${index === 0 ? blockPrefix : blockIndent}${line}`)
      : [];
    const hint = bodyRows >= 4 ? [dim(` ${this.textEdit ? strings.itemTypingKeys : strings.itemKeys}`)] : [];
    const showFieldHint = controls.includes("format") && bodyRows >= 8 && ITEM_FIELDS[id]?.length;
    const fieldHint = showFieldHint
      ? [
        "",
        ...wrapFieldHint(
          ` ${strings.itemAvailableFields("")}`,
          ITEM_FIELDS[id].map((name) => `{${name}}`),
          Math.max(20, innerW),
          bodyRows >= 12 ? 3 : 1,
        ).map(dim),
      ]
      : [];
    const controlLines = controls.map((prop, index) => this.itemFieldLine(id, prop, index === this.itemField));
    const spacer = bodyRows >= 7 ? [""] : [];
    const combined = [...header, ...blockLine, ...spacer, ...hint, ...controlLines, ...fieldHint];
    return combined.map((line) => frameRow(line, innerW, columns));
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
      layout: hasRows ? "preset" : "flat",
    };
    const segments = collectSegments(payload, singlePrefs, SAMPLE_GIT, { home: SAMPLE_HOME });
    return renderLine(segments, singlePrefs, { width, color: true }).split(/\r?\n/).filter(Boolean);
  }

  renderStyleBody(innerW, bodyRows, columns) {
    const strings = this.strings;
    const header = [
      ` ${styleBold(strings.styleTitle)}`,
      ` ${styleMuted(strings.styleKeys)}`,
      "",
    ];
    const rows = STYLE_FIELDS.map((field, index) => (
      this.styleFieldLine(field, !this.tabsFocused && index === this.styleField)
    ));
    const room = Math.max(1, bodyRows - header.length);
    const start = Math.max(0, Math.min(this.styleField - Math.floor((room - 1) / 2), Math.max(0, rows.length - room)));
    return [...header, ...rows.slice(start, start + room)].map((line) => frameRow(line, innerW, columns));
  }

  styleFieldLine(field, active, aligned = true) {
    const strings = this.strings;
    let value = this.preferences[field];
    let suffix = "";
    if (field === "layout") {
      value = this.formatLayoutModeValue();
    } else if (field === "colorDepth") value = strings.depths[value] ?? value;
    else if (field === "contextFormat") value = strings.contextFormats[value] ?? value;
    else if (field === "quotaPace") value = strings.quotaPaces[value] ?? value;
    else if (field === "dirStyle") value = strings.dirStyles[value] ?? value;
    else if (field === "theme") {
      const depth = colorDepth("auto", { enabled: true });
      const swatches = renderThemeSwatches(value, depth);
      if (swatches) suffix = `  ${swatches}`;
    }
    const cursor = active ? ">" : " ";
    const label = strings.fields[field];
    return `${cursor} ${aligned ? padVisible(label, 12) : label} ${value}${suffix}`;
  }

  formatLayoutModeValue() {
    const strings = this.strings;
    const mode = layoutModeOf(this.preferences);
    const rows = presetRows(this.preferences);
    if (mode === "flat") return strings.layoutModes.flat;
    if (mode === "preset") {
      return rows.length > 1 ? strings.layoutModes.presetRows(rows.length) : strings.layoutModes.presetSplit;
    }
    return strings.layoutModes.customRows(rows.length);
  }

  footerContent(innerW) {
    if (this.error) return ` ${styleBad(this.error)}`;
    if (this.toast && Date.now() < this.toast.until) {
      return ` ${this.toast.bad ? styleBad(this.toast.text) : styleOk(this.toast.text)}`;
    }
    const strings = this.strings;
    let own;
    if (this.tabsFocused) {
      own = strings.tabHints;
    } else if (this.page === "presets") {
      const shown = this.shownPresets();
      const onMine = shown[this.presetSelected]?.origin === "mine";
      own = strings.presetHints(onMine);
    } else if (this.page === "layout") {
      own = this.layoutSubmode === "item"
        ? (this.textEdit ? strings.itemTypingHints : strings.itemHints)
        : (this.grab ? strings.grabbedHints : strings.layoutHints);
    } else {
      own = strings.styleHints;
    }
    return formatHints(own, strings.globalHints(!this.tabsFocused), innerW);
  }

  renderDialogOverlay(columns, rows) {
    const d = this.dialog;
    const strings = this.strings.dialogs;
    if (d.kind === "help") {
      const pageTitle = this.strings.tabs[this.page];
      const own = this.page === "presets"
        ? this.strings.presetHints(false)
        : this.page === "layout"
          ? this.strings.layoutHints
          : this.strings.styleHints;
      const body = [
        ...own.map(([k, desc]) => `  ${styleAccent(padVisible(k, 8))} ${desc}`),
        "",
        `  ${styleBold(strings.helpPreviewHeader)}`,
        ...strings.helpPreviewLines.map((line) => `  ${line}`),
        "",
        `  ${styleMuted(strings.helpClose)}`,
      ];
      return buildPopupOverlay(columns, rows, strings.helpTitle(pageTitle), body, { width: 58 });
    }

    if (d.kind === "preset-confirm") {
      const heading = d.mode === "replace" ? strings.replaceTitle(d.name) : strings.deleteTitle(d.name);
      const body = [
        `  ${heading}`,
        "",
        `  ${styleMuted(strings.confirmKeys)}`,
      ];
      return buildPopupOverlay(columns, rows, heading, body, {
        width: 56,
        borderColor: d.mode === "delete" ? BAD : ACCENT,
      });
    }

    if (d.kind === "preset-form") {
      const titleText = d.mode === "create"
        ? strings.savePresetTitle
        : strings.renamePresetTitle(d.originalName);
      const slug = slugifyPresetName(d.name);
      const nameVal = d.focus === 0 ? `${d.name}_` : d.name;
      const sumVal = d.focus === 1 ? `${d.summary}_` : d.summary;
      const warn = Object.prototype.hasOwnProperty.call(PRESETS, slug)
        ? styleBad(strings.builtinWarn)
        : d.error
          ? styleBad(d.error)
          : styleMuted(strings.filePreview(slug));
      const body = [
        ` ${d.focus === 0 ? styleAccent(">") : " "} ${padVisible(strings.nameLabel, 9)} ${nameVal}`,
        ` ${d.focus === 1 ? styleAccent(">") : " "} ${padVisible(strings.summaryLabel, 9)} ${sumVal}`,
        "",
        `  ${warn}`,
        "",
        `  ${styleMuted(strings.formFooter)}`,
      ];
      return buildPopupOverlay(columns, rows, titleText, body, { width: 60 });
    }

    if (d.kind === "commands") {
      const all = this.commandItems();
      const q = d.query.trim().toLowerCase();
      const matched = q ? all.filter((item) => item.label.toLowerCase().includes(q) || item.id.includes(q)) : all;
      d.selected = Math.max(0, Math.min(d.selected, Math.max(0, matched.length - 1)));
      const listRoom = Math.max(3, Math.min(10, rows - 8));
      const start = Math.max(0, Math.min(d.selected - Math.floor((listRoom - 1) / 2), Math.max(0, matched.length - listRoom)));
      const listLines = matched.slice(start, start + listRoom).map((item, idx) => {
        const active = start + idx === d.selected;
        return ` ${active ? styleAccent(">") : " "} ${active ? styleBold(item.label) : item.label}`;
      });
      const body = [
        `  ${styleMuted(strings.commandsFilter)} ${d.query}_`,
        "",
        ...(listLines.length ? listLines : [`  ${styleMuted("—")}`]),
        "",
        `  ${styleMuted(strings.commandsFooter)}`,
      ];
      return buildPopupOverlay(columns, rows, strings.commandsTitle, body, { width: 58 });
    }

    return "";
  }
}

function cloneRows(preferences) {
  return presetRows(preferences).map((row) => ({
    left: row.left.slice(),
    right: row.right.slice(),
  }));
}

function findInRows(rows, id) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const side of ["left", "right"]) {
      const itemIndex = rows[rowIndex][side].findIndex((item) => item.metric === id);
      if (itemIndex >= 0) return { rowIndex, side, itemIndex };
    }
  }
  return null;
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
  return { h: "left", l: "right", j: "down", k: "up", " ": "toggle", "?": "help", e: "edit", r: "reset", b: "break", a: "align" }[text];
}

function namesFor(field) {
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

function wrapFieldHint(prefix, tokens, maxWidth, maxLines = 3) {
  if (!tokens.length) return [];
  const indent = " ".repeat(visibleWidth(prefix));
  const lines = [];
  let line = prefix;
  let count = 0;
  for (const token of tokens) {
    const sep = count > 0 ? " " : "";
    const candidate = `${line}${sep}${token}`;
    if (count > 0 && visibleWidth(candidate) > maxWidth) {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
      line = `${indent}${token}`;
      count = 1;
    } else {
      line = candidate;
      count += 1;
    }
  }
  if (count > 0 && lines.length < maxLines) lines.push(line);
  return lines;
}
