/**
 * `segments` contains the enabled IDs in display order. Custom layouts store
 * the segment counts for the left and right sides of each row.
 */

import { sanitizeText } from "./ansi.mjs";
import { CCLINE_PALETTES, CCLINE_PRESETS } from "./ccline-data.mjs";

export const PREFERENCES_VERSION = 2;
export const COLOR_DEPTHS = { auto: "Auto", truecolor: "Truecolor", "256": "256 colors", "16": "16 colors", none: "No color" };
export const CONTEXT_FORMATS = {
  auto: "Auto",
  percent: "Percent",
  tokens: "Percent + used",
  ratio: "Percent + used/total",
};
export const QUOTA_PACES = {
  auto: "Auto",
  show: "Show",
  hide: "Hide",
};
export const DIR_STYLES = {
  auto: "Auto",
  name: "Name",
  parent: "Parent",
  tilde: "Tilde",
  short: "Short",
  full: "Full",
};

export const ITEM_WIDGETS = {
  context: ["bar", "gauge", "text", "legacy-bar"],
  "quota.5h": ["pace", "bar", "gauge", "text"],
  "quota.7d": ["pace", "bar", "gauge", "text"],
};

export const ITEM_FIELDS = {
  model: ["name", "effort", "family", "id"],
  dir: ["path", "name", "parent", "tilde", "short", "full"],
  git: ["branch", "dirty", "status", "ahead", "behind", "sha", "staged", "modified", "untracked", "conflicts"],
  context: ["pct", "tokens", "window", "left"],
  "quota.5h": ["pct", "left", "reset", "pace", "arrow"],
  "quota.7d": ["pct", "left", "reset", "pace", "arrow"],
  quota: ["text", "pct", "left", "reset"],
  "quota.eta": ["left"],
  cache: ["read", "created"],
  cost: ["usd"],
  worktree: ["name"],
  state: ["state"],
  cycle: ["mode"],
  sandbox: ["state"],
  vcs: ["type"],
};

export const ITEM_FORMAT_PRESETS = {
  model: ["{name}[ {effort}]", "{name}", "{family}", "{id}"],
  dir: ["{path}", "{name}", "{parent}", "{tilde}", "{short}", "{full}"],
  git: [
    "{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}]",
    "{branch}[ {dirty}][ {ahead}][ {behind}]",
    "{branch}[ +{staged}][ ~{modified}][ ?{untracked}][ {sha}]",
    "{branch}[ {sha}]",
    "{branch}",
  ],
  context: [
    "{pct}%[ · {tokens}]",
    "{pct}%[ · {tokens}[/{window}]]",
    "{pct}%[ · {left} left]",
    "{pct}%[ · {tokens} tokens]",
    "ctx {pct}%",
    "{pct}%",
  ],
  "quota.5h": [
    "5h {pct}%[ {arrow}][ · {left}]",
    "5h {pct}%[ · {left}]",
    "5h {pct}%[ · {reset}]",
    "5h {pct}%[ {pace}][ · {left}]",
    "5h {pct}%",
    "{pct}%",
  ],
  "quota.7d": [
    "7d {pct}%[ {arrow}][ · {left}]",
    "7d {pct}%[ · {left}]",
    "7d {pct}%[ · {reset}]",
    "7d {pct}%[ {pace}][ · {left}]",
    "7d {pct}%",
    "{pct}%",
  ],
  quota: ["{text}[ · {left}]", "{text}", "{pct}%[ · {left}]"],
  "quota.eta": ["ETA {left}", "out in {left}", "{left}"],
  cache: ["cache {read} read[ · {created} created]", "cache {read}[ · +{created}]", "{read} read"],
  cost: ["{usd}", "cost {usd}"],
  worktree: ["{name}", "wt:{name}"],
  state: ["{state}", "state:{state}"],
  cycle: ["{mode}", "mode:{mode}"],
  sandbox: ["{state}", "sandbox:{state}"],
  vcs: ["{type}", "vcs:{type}"],
};

export const SEGMENT_REGISTRY = [
  { id: "model", label: "Model", hint: "display name, id, effort" },
  { id: "dir", label: "Directory", hint: "workspace folder" },
  { id: "git", label: "Git", hint: "branch, sha, status, ahead/behind" },
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
    .filter(item => SEGMENT_IDS.includes(item.metric) && !(item.metric === "cache" && item.widget === "bar"))
    .map(item => {
      if (item.metric !== "cache") return item;
      const cleaned = { ...item };
      for (const key of ["format", "compact", "minimal"]) {
        if (typeof cleaned[key] === "string" && /\{(left|cold|hit|misses|cause|rewarm|state|ttl)\}/.test(cleaned[key])) {
          delete cleaned[key];
        }
      }
      return cleaned;
    });
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
  quotaPace: QUOTA_PACES,
  dirStyle: DIR_STYLES,
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
    quotaPace: preset.quotaPace ?? "auto",
    dirStyle: preset.dirStyle ?? "auto",
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
  const quotaPace = source.quotaPace == null ? base.quotaPace : String(source.quotaPace);
  const dirStyle = source.dirStyle == null ? base.dirStyle : String(source.dirStyle);
  if (!isKnown("colorDepth", colorDepth)) throw new PreferenceError(`unknown color depth '${colorDepth}'`, "colorDepth");
  if (!isKnown("contextFormat", contextFormat)) throw new PreferenceError(`unknown context format '${contextFormat}'`, "contextFormat");
  if (!isKnown("quotaPace", quotaPace)) throw new PreferenceError(`unknown quota pace '${quotaPace}'`, "quotaPace");
  if (!isKnown("dirStyle", dirStyle)) throw new PreferenceError(`unknown directory style '${dirStyle}'`, "dirStyle");
  if (!isKnown("theme", theme)) throw new PreferenceError(`unknown theme '${theme}'`, "theme");
  if (!isKnown("skin", skin)) throw new PreferenceError(`unknown skin '${skin}'`, "skin");
  if (!isKnown("icons", icons)) throw new PreferenceError(`unknown icons '${icons}'`, "icons");
  const segments = source.segments == null ? base.segments : parseSegments(source.segments);
  const layout = resolveLayout(source, preset, segments);
  const items = normalizeItems(source.items);
  return {
    version: PREFERENCES_VERSION,
    preset,
    theme,
    skin,
    icons,
    colorDepth,
    contextFormat,
    quotaPace,
    dirStyle,
    segments,
    ...(layout ? { layout } : {}),
    ...(items ? { items } : {}),
  };
}

function normalizeItems(raw) {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new PreferenceError("items must be an object", "items");
  }
  const out = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!SEGMENT_IDS.includes(id)) {
      throw new PreferenceError(`unknown segment '${id}' in items`, "items");
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PreferenceError(`invalid item override for '${id}'`, "items");
    }
    const clean = {};
    if (entry.widget != null) {
      const widget = String(entry.widget);
      const allowed = ITEM_WIDGETS[id] ?? ["text"];
      if (!allowed.includes(widget)) {
        throw new PreferenceError(`unknown widget '${widget}' for '${id}'`, "items");
      }
      clean.widget = widget;
    }
    if (entry.icon != null) {
      if (typeof entry.icon !== "string") {
        throw new PreferenceError(`icon for '${id}' must be a string`, "items");
      }
      clean.icon = [...sanitizeText(entry.icon)].slice(0, 16).join("");
    }
    if (entry.format != null) {
      if (typeof entry.format !== "string") {
        throw new PreferenceError(`format for '${id}' must be a string`, "items");
      }
      const format = sanitizeText(entry.format).trim().slice(0, 120);
      if (format) clean.format = format;
    }
    if (Object.keys(clean).length > 0) out[id] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const { segments, layout, items: overrides } = preferences;
  const merge = (base) => {
    const override = overrides?.[base.metric];
    return override ? { ...base, ...override } : base;
  };
  const rows = PRESETS[preferences.preset]?.rows;
  if (!rows || !layout || layout === "flat") {
    return [{ left: segments.map(metric => merge({ metric })), right: [] }];
  }
  const items = new Map(rows.flatMap(row => [...row.left, ...row.right].map(item => [item.metric, item])));
  const enabled = new Set(segments);
  const counts = layout === "preset" ? rows.map(row => [
    row.left.filter(item => enabled.has(item.metric)).length,
    row.right.filter(item => enabled.has(item.metric)).length,
  ]) : layout;
  const pending = segments.map(metric => merge(items.get(metric) ?? { metric }));
  const resolved = counts.map(([left, right]) => ({ left: pending.splice(0, left), right: pending.splice(0, right) }));
  if (pending.length) resolved.push({ left: pending, right: [] });
  return resolved;
}

export function presetBaseItem(preferences, metric) {
  const rows = PRESETS[preferences.preset]?.rows;
  if (!rows || !preferences.layout || preferences.layout === "flat") return { metric };
  for (const row of rows) {
    for (const item of [...row.left, ...row.right]) {
      if (item.metric === metric) return item;
    }
  }
  return { metric };
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
