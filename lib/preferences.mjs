/**
 * Canonical preferences: { preset, theme, skin, icons, segments }.
 * `version` is stored alongside so a future renderer can refuse unknown files.
 *
 * segments is the enabled subset in display order. The registry below is the
 * full ordered catalog the editor and the renderer both walk.
 */

export const PREFERENCES_VERSION = 1;

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
];

export const SEGMENT_IDS = SEGMENT_REGISTRY.map((segment) => segment.id);

export const DEFAULT_SEGMENTS = ["model", "dir", "git", "context", "state"];

export const PRESETS = {
  studio: {
    label: "Studio",
    theme: "dusk",
    skin: "powerline",
    icons: "unicode",
    segments: ["model", "dir", "git", "context", "quota", "cost", "state"],
  },
  focus: {
    label: "Focus",
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
  const preset = source.preset ?? "studio";
  if (!isKnown("preset", preset)) {
    throw new PreferenceError(`unknown preset '${preset}'`, "preset");
  }
  const base = { preset, ...presetBody(preset) };
  const theme = source.theme ?? base.theme;
  const skin = source.skin ?? base.skin;
  const icons = source.icons ?? base.icons;
  if (!isKnown("theme", theme)) throw new PreferenceError(`unknown theme '${theme}'`, "theme");
  if (!isKnown("skin", skin)) throw new PreferenceError(`unknown skin '${skin}'`, "skin");
  if (!isKnown("icons", icons)) throw new PreferenceError(`unknown icons '${icons}'`, "icons");
  const segments = source.segments == null ? base.segments : parseSegments(source.segments);
  return {
    version: PREFERENCES_VERSION,
    preset,
    theme,
    skin,
    icons,
    segments,
  };
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
