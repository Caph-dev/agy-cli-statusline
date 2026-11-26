/**
 * `segments` contains the enabled IDs in display order. Custom layouts store
 * the segment counts for the left and right sides of each row.
 */

import { CCLINE_PALETTES, CCLINE_PRESETS } from "./ccline-data.mjs";

export const PREFERENCES_VERSION = 2;
export const COLOR_DEPTHS = { auto: "Auto", truecolor: "Truecolor", "256": "256 colors", "16": "16 colors", none: "No color" };
export const CONTEXT_FORMATS = {
  auto: "Auto",
  percent: "Percent",
  tokens: "Percent + used",
  ratio: "Percent + used/total",
};

export const SEGMENT_REGISTRY = [
  { id: "model", label: "Model", hint: "display name, id, effort" },
  { id: "dir", label: "Directory", hint: "workspace folder" },
  { id: "git", label: "Git", hint: "branch, dirty, ahead/behind" },
  { id: "context", label: "Context", hint: "window gauge" },
  { id: "quota", label: "Quota", hint: "only when a bucket is present" },
  { id: "cost", label: "Cost", hint: "only when cost is present" },
  { id: "state", label: "Agent", hint: "agent state" },
  { id: "cycle", label: "Cycle", hint: "cycle mode" },
  { id: "sandbox", label: "Sandbox", hint: "sandbox on/off" },
  { id: "vcs", label: "VCS", hint: "version-control type" },
  { id: "quota.5h", label: "5-hour quota", hint: "5-hour quota when reported" },
  { id: "quota.7d", label: "Weekly quota", hint: "weekly quota when reported" },
  { id: "quota.eta", label: "Quota ETA", hint: "estimated run-out from quota pace" },
  { id: "cache", label: "Cache", hint: "cache read and creation tokens" },
  { id: "worktree", label: "Worktree", hint: "linked Git worktree name" },
];

export const SEGMENT_IDS = SEGMENT_REGISTRY.map((segment) => segment.id);

export const DEFAULT_SEGMENTS = ["model", "dir", "git", "context", "state"];

const BUILTIN_PRESETS = Object.fromEntries(Object.entries(CCLINE_PRESETS).map(([id, source]) => {
  const rows = source.line.map(row => ({
    left: supportedItems(row.left),
    right: supportedItems(row.right),
  }));
  const segments = [...new Set(rows.flatMap(row => [...row.left, ...row.right].map(item => item.metric)))];
  return [id, {
    label: id, theme: source.palette, skin: source.skin, icons: source.glyphs,
    colorDepth: source.color_depth ?? "auto", separator: source.separator, rows, segments,
  }];
}));

function supportedItems(items = []) {
  return items.map(item => typeof item === "string" ? { metric: item } : item)
    .filter(item => SEGMENT_IDS.includes(item.metric) && !(item.metric === "cache" && item.widget === "bar"));
}

export const PRESETS = {
  ...BUILTIN_PRESETS,
  studio: {
    label: "Studio",
    theme: "dusk",
    skin: "powerline",
    icons: "unicode",
    segments: ["model", "dir", "git", "context", "quota", "cost", "state"],
  },
  "focus-legacy": {
    label: "Focus (legacy)",
    theme: "ink",
    skin: "plain",
    icons: "ascii",
    segments: ["model", "dir", "git", "context"],
  },
  compact: {
    label: "Compact",
    theme: "ink",
    skin: "compact",
    icons: "ascii",
    segments: ["model", "git", "context", "state"],
  },
  bracket: {
    label: "Bracket",
    theme: "paper",
    skin: "bracket",
    icons: "unicode",
    segments: ["model", "dir", "git", "context", "state"],
  },
  signal: {
    label: "Signal",
    theme: "signal",
    skin: "powerline",
    icons: "nerd",
    segments: ["model", "dir", "git", "context", "quota", "cost", "state", "sandbox"],
  },
};

export const THEMES = {
  ...CCLINE_PALETTES,
  dusk: {
    label: "Dusk",
    slots: ["magenta", "blue", "cyan", "green", "yellow", "red", "white"],
    gauge: ["green", "yellow", "red"],
    muted: "brightBlack",
    text: "black",
    fill: "white",
  },
  ink: {
    label: "Ink",
    slots: ["white", "cyan", "green", "yellow", "blue", "magenta", "red"],
    gauge: ["green", "yellow", "red"],
    muted: "brightBlack",
    text: "black",
    fill: "white",
  },
  paper: {
    label: "Paper",
    slots: ["blue", "magenta", "cyan", "green", "yellow", "red", "white"],
    gauge: ["blue", "yellow", "red"],
    muted: "brightBlack",
    text: "black",
    fill: "white",
  },
  signal: {
    label: "Signal",
    slots: ["green", "cyan", "yellow", "magenta", "blue", "red", "white"],
    gauge: ["cyan", "yellow", "red"],
    muted: "brightBlack",
    text: "black",
    fill: "white",
  },
  mono: {
    label: "Mono",
    slots: ["white", "brightBlack", "white", "brightBlack", "white", "brightBlack", "white"],
    gauge: ["white", "white", "white"],
    muted: "brightBlack",
    text: "black",
    fill: "white",
  },
};

export const SKINS = {
  powerline: { label: "Powerline", separator: "chevron", pad: " " },
  plain: { label: "Plain", separator: "dot", pad: "" },
  compact: { label: "Compact", separator: "pipe", pad: "" },
  bracket: { label: "Bracket", separator: "none", pad: "" },
  pill: { label: "Pill", separator: "space", pad: " " },
};

export const ICON_SETS = {
  unicode: {
    label: "Unicode",
    model: "\u25c6", dir: "\u25c8", git: "\u2387", context: "\u25d0",
    quota: "\u29bf", cost: "\u00b7", state: "\u25cf", cycle: "\u21bb",
    sandbox: "\u25a3", vcs: "\u2261", dirty: "\u2022", clean: "", ahead: "\u2191",
    behind: "\u2193", warn: "!",
  },
  ascii: {
    label: "ASCII",
    model: "@", dir: "~", git: "git", context: "ctx",
    quota: "q", cost: "$", state: "*", cycle: "~",
    sandbox: "sbx", vcs: "vcs", dirty: "*", clean: "", ahead: "+",
    behind: "-", warn: "!",
  },
  nerd: {
    label: "Nerd",
    model: "\uf0e7", dir: "\uf07c", git: "\ue725", context: "\uf0c9",
    quota: "\uf49b", cost: "\uf155", state: "\uf111", cycle: "\uf2f1",
    sandbox: "\uf023", vcs: "\uf126", dirty: "\uf069", clean: "", ahead: "\uf062",
    behind: "\uf063", warn: "\uf071",
  },
  none: {
    label: "None",
    model: "", dir: "", git: "", context: "",
    quota: "", cost: "", state: "", cycle: "",
    sandbox: "", vcs: "", dirty: "*", clean: "", ahead: "+",
    behind: "-", warn: "!",
  },
};

const ENUMS = {
  preset: PRESETS,
  theme: THEMES,
  skin: SKINS,
  icons: ICON_SETS,
  colorDepth: COLOR_DEPTHS,
  contextFormat: CONTEXT_FORMATS,
};

export function enumNames(kind) {
  return Object.keys(ENUMS[kind]);
}

export function isKnown(kind, name) {
  return Object.prototype.hasOwnProperty.call(ENUMS[kind], name);
}

export function defaultPreferences() {
  return normalizePreferences({ preset: "studio" });
}

export function presetBody(name) {
  const preset = PRESETS[name];
  if (!preset) return null;
  return {
    theme: preset.theme,
    skin: preset.skin,
    icons: preset.icons,
    colorDepth: preset.colorDepth ?? "auto",
    contextFormat: preset.contextFormat ?? "auto",
    segments: preset.segments.slice(),
  };
}

/**
 * Merge a partial onto defaults, then onto a named preset when one is set.
 * Explicit theme/skin/icons/segments win over the preset.
 * Unknown enum values and unknown segment ids throw; callers turn that into
 * a non-zero exit before any file is touched.
 */
export function normalizePreferences(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const preset = source.version === 1 && source.preset === "focus" ? "focus-legacy" : source.preset ?? "studio";
  if (!isKnown("preset", preset)) {
    throw new PreferenceError(`unknown preset '${preset}'`, "preset");
  }
  const base = { preset, ...presetBody(preset) };
  const theme = source.theme ?? base.theme;
  const skin = source.skin ?? base.skin;
  const icons = source.icons ?? base.icons;
  const colorDepth = source.colorDepth == null ? base.colorDepth : String(source.colorDepth);
  const contextFormat = source.contextFormat == null ? base.contextFormat : String(source.contextFormat);
  if (!isKnown("colorDepth", colorDepth)) throw new PreferenceError(`unknown color depth '${colorDepth}'`, "colorDepth");
  if (!isKnown("contextFormat", contextFormat)) throw new PreferenceError(`unknown context format '${contextFormat}'`, "contextFormat");
  if (!isKnown("theme", theme)) throw new PreferenceError(`unknown theme '${theme}'`, "theme");
  if (!isKnown("skin", skin)) throw new PreferenceError(`unknown skin '${skin}'`, "skin");
  if (!isKnown("icons", icons)) throw new PreferenceError(`unknown icons '${icons}'`, "icons");
  const segments = source.segments == null ? base.segments : parseSegments(source.segments);
  const layout = resolveLayout(source, preset, segments);
  return {
    version: PREFERENCES_VERSION,
    preset,
    theme,
    skin,
    icons,
    colorDepth,
    contextFormat,
    segments,
    ...(layout ? { layout } : {}),
  };
}

function resolveLayout(source, presetName, segments) {
  const preset = PRESETS[presetName];
  if (!preset?.rows) return undefined;
  const requested = source.layout;
  if (requested === "flat" || requested === "preset") return requested;
  if (Array.isArray(requested)) {
    const valid = requested.every(row => Array.isArray(row) && row.length === 2 &&
      row.every(count => Number.isInteger(count) && count >= 0) && row[0] + row[1] > 0);
    if (!valid || requested.flat().reduce((total, count) => total + count, 0) !== segments.length) {
      throw new PreferenceError("layout counts must match the enabled segments", "layout");
    }
    return requested.map(row => row.slice());
  }
  if (requested != null) throw new PreferenceError(`unknown layout '${requested}'`, "layout");
  const enabled = new Set(segments);
  const presetOrder = preset.segments.filter(id => enabled.has(id));
  const sameOrder = presetOrder.join(",") === segments.join(",");
  return sameOrder ? "preset" : undefined;
}

export function presetRows(preferences) {
  const { segments, layout } = preferences;
  const rows = PRESETS[preferences.preset]?.rows;
  if (!rows || !layout || layout === "flat") return [{ left: segments.map(metric => ({ metric })), right: [] }];
  const items = new Map(rows.flatMap(row => [...row.left, ...row.right].map(item => [item.metric, item])));
  const enabled = new Set(segments);
  const counts = layout === "preset" ? rows.map(row => [
    row.left.filter(item => enabled.has(item.metric)).length,
    row.right.filter(item => enabled.has(item.metric)).length,
  ]) : layout;
  const pending = segments.map(metric => items.get(metric) ?? { metric });
  const resolved = counts.map(([left, right]) => ({ left: pending.splice(0, left), right: pending.splice(0, right) }));
  if (pending.length) resolved.push({ left: pending, right: [] });
  return resolved;
}

export function parseSegments(value) {
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
  if (list.length === 0) {
    throw new PreferenceError("segments must name at least one segment", "segments");
  }
  const seen = new Set();
  const ordered = [];
  for (const id of list) {
    if (!SEGMENT_IDS.includes(id)) {
      throw new PreferenceError(`unknown segment '${id}'`, "segments");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export class PreferenceError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "PreferenceError";
    this.field = field;
  }
}
