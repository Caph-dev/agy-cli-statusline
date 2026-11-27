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
  context: ["gauge", "bar", "text", "legacy-bar"],
  "quota.5h": ["pace", "bar", "gauge", "text"],
  "quota.7d": ["pace", "bar", "gauge", "text"],
  cache: ["text", "bar", "gauge"],
  subagents: ["tree", "inline"],
};

export function defaultWidgetFor(id, baseItem = {}, { native = false, icons = "unicode", preset = "" } = {}) {
  if (baseItem.widget) return baseItem.widget;
  if (id === "context") {
    if (baseItem.bar) return "bar";
    if (preset === "focus-legacy" || icons === "ascii") return native ? "bar" : "legacy-bar";
    return "gauge";
  }
  if (id === "subagents") return "tree";
  if (id.startsWith("quota.")) return "pace";
  return "text";
}

export const ITEM_FIELDS = {
  model: ["name", "effort", "base", "active", "stage", "phase", "tag", "exec", "family", "id"],
  dir: ["path", "name", "parent", "tilde", "short", "full"],
  git: ["branch", "dirty", "status", "ahead", "behind", "sha", "staged", "modified", "untracked", "conflicts", "files", "added", "deleted"],
  context: ["pct", "tokens", "window", "left"],
  "quota.5h": ["pct", "left", "reset", "pace", "arrow"],
  "quota.7d": ["pct", "left", "reset", "pace", "arrow"],
  quota: ["text", "pct", "left", "reset"],
  "quota.eta": ["left"],
  cache: ["left", "cold", "hit", "misses", "cause", "rewarm", "state", "ttl", "read", "created"],
  cost: ["usd"],
  "cost.today": ["usd", "calls", "convs"],
  tps: ["tps", "ttft", "total", "median", "out"],
  worktree: ["name"],
  state: ["state"],
  subagents: ["running", "waiting", "done", "active", "total", "names", "cost"],
  cycle: ["mode"],
  sandbox: ["state"],
  vcs: ["type"],
};

export const ITEM_FORMAT_PRESETS = {
  model: [
    "{name}[ {effort}]",
    "{base}[ → {exec}][ {effort}]",
    "{stage}[ {effort}]",
    "[{phase} · ]{active}[ {effort}]",
    "[{tag}: ]{active}[ {effort}]",
    "{active}[ ({tag})][ {effort}]",
    "{active}[ {effort}]",
    "{base}[ {effort}]",
    "{name}",
    "{family}",
    "{id}",
  ],
  dir: ["{path}", "{name}", "{parent}", "{tilde}", "{short}", "{full}"],
  git: [
    "{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}]",
    "{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}][ · {files}f[ {added}][ {deleted}]]",
    "{branch}[ {ahead}][ {behind}][ · {files}f[ {added}][ {deleted}]]",
    "{branch}[ {dirty}][ ({files}f[ {added}][ {deleted}])]",
    "{branch}[ {files}f][ {added}][ {deleted}]",
    "{branch}[ {dirty}][ {added}][ {deleted}]",
    "{branch}[ +{staged}][ ~{modified}][ ?{untracked}][ · {files}f[ {added}][ {deleted}]]",
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
  cache: [
    "[{left}][{cold}][ · {hit}% hit]",
    "[{left}][{cold}][ · {hit}%]",
    "{hit}% hit",
    "{hit}%",
    "[{left}][{cold}][ · {hit}% hit][ · {misses}× miss][ · last: {cause}]",
    "[warm {left}][{cold}][ · {hit}% hit]",
    "[{left}][{cold}][ · rewarm {rewarm}]",
    "[cache {left}][cache {cold}]",
    "{hit}% hit[ · {read} read]",
    "cache {read} read[ · {created} created]",
  ],
  cost: ["{usd}", "cost {usd}"],
  "cost.today": ["{usd} today", "{usd} today[ · {calls} calls]", "{usd}", "today {usd}"],
  tps: ["{tps} tok/s", "{tps} tok/s[ · {ttft}]", "{tps} tok/s[ · med {median}]", "{tps} t/s"],
  worktree: ["{name}", "wt:{name}"],
  state: ["{state}", "state:{state}"],
  subagents: [
    "[{running} running][ · {waiting} waiting][ · {done} done]",
    "{total} subagents[ · {cost}]",
    "[{active} active][ · {names}]",
    "{names}",
  ],
  cycle: ["{mode}", "mode:{mode}"],
  sandbox: ["{state}", "sandbox:{state}"],
  vcs: ["{type}", "vcs:{type}"],
};

// Verified Nerd Font v3 alternative icons per segment (from ryanoasis/nerd-fonts glyphnames.json).
export const ITEM_ICON_PRESETS = {
  model: [
    { glyph: "\u{f0674}", name: "nf-md-creation" },
    { glyph: "\u{ec10}", name: "nf-cod-sparkle" },
    { glyph: "\u{f167a}", name: "nf-md-robot_outline" },
    { glyph: "\u{f061a}", name: "nf-md-chip" },
    { glyph: "\u{f09d1}", name: "nf-md-brain" },
  ],
  dir: [
    { glyph: "\u{f0770}", name: "nf-md-folder_open" },
    { glyph: "\u{f10b5}", name: "nf-md-folder_home" },
    { glyph: "\u{f0256}", name: "nf-md-folder_outline" },
    { glyph: "\u{f413}", name: "nf-oct-file_directory" },
    { glyph: "\u{ea83}", name: "nf-cod-folder" },
  ],
  git: [
    { glyph: "\u{f062c}", name: "nf-md-source_branch" },
    { glyph: "\u{f418}", name: "nf-oct-git_branch" },
    { glyph: "\u{eafe}", name: "nf-cod-git_merge" },
    { glyph: "\u{f417}", name: "nf-oct-git_commit" },
  ],
  context: [
    { glyph: "\u{f07af}", name: "nf-md-chart_donut" },
    { glyph: "\u{f035b}", name: "nf-md-memory" },
    { glyph: "\u{f0f58}", name: "nf-md-layers_triple" },
    { glyph: "\u{f029a}", name: "nf-md-gauge" },
    { glyph: "\u{ebe4}", name: "nf-cod-pie_chart" },
  ],
  quota: [
    { glyph: "\u{f051b}", name: "nf-md-timer_outline" },
    { glyph: "\u{f0150}", name: "nf-md-clock_outline" },
    { glyph: "\u{f051a}", name: "nf-md-timelapse" },
    { glyph: "\u{f12a3}", name: "nf-md-battery_high" },
    { glyph: "\u{eacd}", name: "nf-cod-dashboard" },
  ],
  cost: [
    { glyph: "\u{f0114}", name: "nf-md-cash" },
    { glyph: "\u{f01c1}", name: "nf-md-currency_usd" },
    { glyph: "\u{f0bdd}", name: "nf-md-wallet_outline" },
    { glyph: "\u{ede8}", name: "nf-fa-coins" },
    { glyph: "\u{f1679}", name: "nf-md-piggy_bank_outline" },
  ],
  state: [
    { glyph: "\u{f0430}", name: "nf-md-pulse" },
    { glyph: "\u{f05f6}", name: "nf-md-heart_pulse" },
    { glyph: "\u{f171a}", name: "nf-md-robot_happy_outline" },
    { glyph: "\u{f07b7}", name: "nf-md-console_line" },
    { glyph: "\u{f469}", name: "nf-oct-pulse" },
  ],
  cycle: [
    { glyph: "\u{f006a}", name: "nf-md-autorenew" },
    { glyph: "\u{f04e6}", name: "nf-md-sync" },
    { glyph: "\u{f0456}", name: "nf-md-repeat" },
    { glyph: "\u{f0018}", name: "nf-md-orbit" },
    { glyph: "\u{ea77}", name: "nf-cod-sync" },
  ],
  sandbox: [
    { glyph: "\u{f0cc8}", name: "nf-md-shield_check_outline" },
    { glyph: "\u{f0ccc}", name: "nf-md-shield_lock_outline" },
    { glyph: "\u{f01a7}", name: "nf-md-cube_outline" },
    { glyph: "\u{f03d7}", name: "nf-md-package_variant_closed" },
    { glyph: "\u{f511}", name: "nf-oct-shield_lock" },
  ],
  vcs: [
    { glyph: "\u{f0ccf}", name: "nf-md-source_repository" },
    { glyph: "\u{f0718}", name: "nf-md-source_commit" },
    { glyph: "\u{ea68}", name: "nf-cod-source_control" },
    { glyph: "\u{f401}", name: "nf-oct-repo" },
    { glyph: "\u{f02da}", name: "nf-md-history" },
  ],
  "quota.5h": [
    { glyph: "\u{f0152}", name: "nf-md-clock_fast" },
    { glyph: "\u{f051b}", name: "nf-md-timer_outline" },
    { glyph: "\u{f051a}", name: "nf-md-timelapse" },
    { glyph: "\u{f0996}", name: "nf-md-progress_clock" },
    { glyph: "\u{f2f2}", name: "nf-fa-stopwatch" },
  ],
  "quota.7d": [
    { glyph: "\u{f0a33}", name: "nf-md-calendar_week" },
    { glyph: "\u{f00f0}", name: "nf-md-calendar_clock" },
    { glyph: "\u{f0679}", name: "nf-md-calendar_range" },
    { glyph: "\u{ef38}", name: "nf-fa-calendar_week" },
    { glyph: "\u{f455}", name: "nf-oct-calendar" },
  ],
  "quota.eta": [
    { glyph: "\u{f051f}", name: "nf-md-timer_sand" },
    { glyph: "\u{f0020}", name: "nf-md-alarm" },
    { glyph: "\u{f05ce}", name: "nf-md-clock_alert_outline" },
    { glyph: "\u{f023c}", name: "nf-md-flag_checkered" },
    { glyph: "\u{f006b}", name: "nf-md-av_timer" },
  ],
  cache: [
    { glyph: "\u{f1632}", name: "nf-md-database_outline" },
    { glyph: "\u{f140c}", name: "nf-md-lightning_bolt_outline" },
    { glyph: "\u{f06d5}", name: "nf-md-flash_outline" },
    { glyph: "\u{f035b}", name: "nf-md-memory" },
    { glyph: "\u{eace}", name: "nf-cod-database" },
  ],
  worktree: [
    { glyph: "\u{f0645}", name: "nf-md-file_tree" },
    { glyph: "\u{f04c1}", name: "nf-md-source_fork" },
    { glyph: "\u{f0405}", name: "nf-md-pine_tree" },
    { glyph: "\u{f160e}", name: "nf-md-family_tree" },
    { glyph: "\u{ea63}", name: "nf-cod-repo_forked" },
  ],
  "cost.today": [
    { glyph: "\u{f00f6}", name: "nf-md-calendar_today" },
    { glyph: "\u{f0116}", name: "nf-md-cash_multiple" },
    { glyph: "\u{f0128}", name: "nf-md-chart_bar" },
    { glyph: "\u{ef37}", name: "nf-fa-calendar_day" },
    { glyph: "\u{f0c44}", name: "nf-md-calendar_check_outline" },
  ],
  tps: [
    { glyph: "\u{f0f85}", name: "nf-md-speedometer_medium" },
    { glyph: "\u{f14df}", name: "nf-md-rocket_launch_outline" },
    { glyph: "\u{f0241}", name: "nf-md-flash" },
    { glyph: "\u{f0874}", name: "nf-md-gauge_full" },
    { glyph: "\u{ed2f}", name: "nf-fa-gauge_high" },
  ],
  subagents: [
    { glyph: "\u{f04aa}", name: "nf-md-sitemap" },
    { glyph: "\u{f0645}", name: "nf-md-file_tree" },
    { glyph: "\u{ebba}", name: "nf-cod-type_hierarchy_sub" },
    { glyph: "\u{f000f}", name: "nf-md-account_multiple_outline" },
    { glyph: "\u{f167a}", name: "nf-md-robot_outline" },
  ],
};

export const SEGMENT_REGISTRY = [
  { id: "model", label: "Model", hint: "active model, orchestrator phase, effort" },
  { id: "dir", label: "Directory", hint: "workspace folder" },
  { id: "git", label: "Git", hint: "branch, sha, status, diff stats, ahead/behind" },
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
  { id: "cache", label: "Cache", hint: "prompt cache countdown, hit ratio, misses" },
  { id: "worktree", label: "Worktree", hint: "linked Git worktree name" },
  { id: "cost.today", label: "Today's cost", hint: "estimated today's API-list spend" },
  { id: "tps", label: "Speed (TPS)", hint: "generation speed (tok/s) from latest call" },
  { id: "subagents", label: "Subagents", hint: "active and recent subagent tree (model, ctx, cache, cost, status)" },
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
  const out = [];
  for (const raw of items) {
    const item = typeof raw === "string" ? { metric: raw } : { ...raw };
    if (!SEGMENT_IDS.includes(item.metric)) continue;
    const existing = out.find((entry) => entry.metric === item.metric);
    if (existing) {
      if (item.format) {
        const extra = item.format.startsWith("[") && !item.format.startsWith("[ · ")
          ? `[ · ${item.format.slice(1)}`
          : `[ · ${item.format}]`;
        existing.format = existing.format ? `${existing.format}${extra}` : item.format;
      }
      continue;
    }
    out.push(item);
  }
  return out;
}

export const PRESETS = {
  ...BUILTIN_PRESETS,
  author: {
    label: "Author",
    theme: "catppuccin-mocha",
    skin: "plain",
    icons: "nerd",
    colorDepth: "auto",
    contextFormat: "auto",
    quotaPace: "auto",
    dirStyle: "parent",
    separator: " | ",
    rows: [
      {
        left: [
          { metric: "model", nerd_icon: "\u{f0674}", format: "[{tag}: ]{active}[ {effort}]" },
          { metric: "context", widget: "gauge", format: "{pct}%[ · {tokens}[/{window}]]" },
          { metric: "cache", format: "{hit}% hit[ · {read} read]" },
          { metric: "tps", format: "{tps} tok/s[ · med {median}]" },
        ],
        right: [],
      },
      {
        left: [
          { metric: "dir", icon_color: "bright_yellow" },
          { metric: "git", nerd_icon: "\u{f418}", format: "{branch}[ {ahead}][ {behind}][ · {files}f[ {added}][ {deleted}]]" },
          { metric: "worktree", format: "wt:{name}" },
          { metric: "state", nerd_icon: "\u{f469}" },
        ],
        right: [],
      },
      {
        left: [
          { metric: "quota.5h" },
          { metric: "quota.7d" },
          { metric: "cost" },
          { metric: "cost.today", format: "{usd} today[ · {calls} calls]" },
          { metric: "subagents", icon: "" },
        ],
        right: [],
      },
    ],
    segments: [
      "model",
      "context",
      "cache",
      "tps",
      "dir",
      "git",
      "worktree",
      "state",
      "quota.5h",
      "quota.7d",
      "cost",
      "cost.today",
      "subagents",
    ],
  },
  studio: {
    label: "Studio",
    theme: "dusk",
    skin: "powerline",
    icons: "unicode",
    segments: ["model", "dir", "git", "context", "quota", "cost", "state", "subagents"],
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
    segments: ["model", "dir", "git", "context", "quota", "cost", "state", "sandbox", "subagents"],
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
    quota: "\u29bf", cache: "\u2248", cost: "\u00b7", "cost.today": "\u25a6", tps: "\u00bb",
    state: "\u25cf", subagents: "\u2442", cycle: "\u21bb", sandbox: "\u25a3", vcs: "\u2261",
    dirty: "\u2022", clean: "", ahead: "\u2191", behind: "\u2193", warn: "!",
  },
  ascii: {
    label: "ASCII",
    model: "@", dir: "~", git: "git", context: "ctx",
    quota: "q", cache: "cache", cost: "$", "cost.today": "day", tps: "tps",
    state: "*", subagents: "sub", cycle: "~", sandbox: "sbx", vcs: "vcs",
    dirty: "*", clean: "", ahead: "+", behind: "-", warn: "!",
  },
  nerd: {
    label: "Nerd",
    model: "\uf0e7", dir: "\uf07c", git: "\ue725", context: "\uf0c9",
    quota: "\uf49b", cache: "\uf1c0", cost: "\uf155", "cost.today": "\u{f00ed}", tps: "\u{f04c5}",
    state: "\uf111", subagents: "\u{f04aa}", cycle: "\uf2f1", sandbox: "\uf023", vcs: "\uf126",
    dirty: "*", clean: "", ahead: "\u2191", behind: "\u2193", warn: "!",
  },
  none: {
    label: "None",
    model: "", dir: "", git: "", context: "",
    quota: "", cache: "", cost: "", "cost.today": "", tps: "",
    state: "", subagents: "", cycle: "", sandbox: "", vcs: "",
    dirty: "*", clean: "", ahead: "+", behind: "-", warn: "!",
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
  const customPreset = typeof source.customPreset === "string"
    ? sanitizeText(source.customPreset).trim().slice(0, 32)
    : "";
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
    ...(customPreset ? { customPreset } : {}),
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

export function presetHasStructuredLayout(presetName) {
  const rows = PRESETS[presetName]?.rows;
  if (!rows || rows.length === 0) return false;
  return rows.length > 1 || rows.some((row) => row.right.length > 0);
}

export function layoutModeOf(preferences) {
  if (Array.isArray(preferences.layout)) return "custom";
  if (preferences.layout === "preset" && presetHasStructuredLayout(preferences.preset)) return "preset";
  return "flat";
}

export function seedCustomLayout(preferences) {
  if (presetHasStructuredLayout(preferences.preset)) {
    const rows = presetRows({ ...preferences, layout: "preset" });
    if (rows.length > 1 || rows.some((row) => row.right.length > 0)) {
      return rows.map((row) => [row.left.length, row.right.length]);
    }
  }
  const n = preferences.segments.length;
  if (n >= 2) return [[Math.ceil(n / 2), 0], [Math.floor(n / 2), 0]];
  return n === 1 ? [[1, 0]] : [];
}

export function parseLayoutFlag(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "flat" || trimmed === "auto") return "flat";
  if (trimmed === "preset") return "preset";
  if (!trimmed) throw new PreferenceError(`unknown layout '${value}'`, "layout");
  const rows = trimmed.split(",").map((part) => {
    const match = /^(\d+)(?::(\d+))?$/.exec(part.trim());
    if (!match) throw new PreferenceError(`unknown layout '${value}'`, "layout");
    const left = Number(match[1]);
    const right = match[2] != null ? Number(match[2]) : 0;
    if (!Number.isInteger(left) || !Number.isInteger(right) || left + right <= 0) {
      throw new PreferenceError(`unknown layout '${value}'`, "layout");
    }
    return [left, right];
  });
  return rows;
}

export function parseSegmentsAndLayout(value) {
  if (Array.isArray(value)) return { segments: parseSegments(value), layout: undefined };
  const text = String(value ?? "");
  if (!text.includes("/") && !text.includes("|")) {
    return { segments: parseSegments(text), layout: undefined };
  }
  const rawRows = text.split("/");
  const seen = new Set();
  const segments = [];
  const layout = [];
  const parseSide = (part) => {
    const list = String(part ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    let added = 0;
    for (const id of list) {
      if (!SEGMENT_IDS.includes(id)) {
        throw new PreferenceError(`unknown segment '${id}'`, "segments");
      }
      if (seen.has(id)) continue;
      seen.add(id);
      segments.push(id);
      added += 1;
    }
    return added;
  };
  for (const rawRow of rawRows) {
    const rowText = rawRow.trim();
    if (!rowText) {
      throw new PreferenceError("empty row in segments", "segments");
    }
    const sides = rowText.split("|");
    if (sides.length > 2) {
      throw new PreferenceError("each row can contain at most one '|' for left/right split", "segments");
    }
    const leftCount = parseSide(sides[0]);
    const rightCount = sides.length === 2 ? parseSide(sides[1]) : 0;
    if (leftCount + rightCount === 0) {
      throw new PreferenceError("empty row in segments", "segments");
    }
    layout.push([leftCount, rightCount]);
  }
  if (segments.length === 0) {
    throw new PreferenceError("segments must name at least one segment", "segments");
  }
  return { segments, layout };
}

function resolveLayout(source, presetName, segments) {
  const preset = PRESETS[presetName];
  const requested = source.layout;
  if (requested === "flat" || requested === "auto") return "flat";
  if (requested === "preset") return preset?.rows ? "preset" : "flat";
  if (Array.isArray(requested)) {
    const valid = requested.every(row => Array.isArray(row) && row.length === 2 &&
      row.every(count => Number.isInteger(count) && count >= 0) && row[0] + row[1] > 0);
    if (!valid || requested.flat().reduce((total, count) => total + count, 0) !== segments.length) {
      throw new PreferenceError("layout counts must match the enabled segments", "layout");
    }
    return requested.map(row => row.slice());
  }
  if (requested != null) throw new PreferenceError(`unknown layout '${requested}'`, "layout");
  if (!preset?.rows) return undefined;
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
  const items = rows
    ? new Map(rows.flatMap(row => [...row.left, ...row.right].map(item => [item.metric, item])))
    : new Map();
  const makeItem = (metric) => merge(items.get(metric) ?? { metric });
  if (!layout || layout === "flat" || (layout === "preset" && !rows)) {
    return [{ left: segments.map(makeItem), right: [] }];
  }
  const enabled = new Set(segments);
  const counts = layout === "preset" ? rows.map(row => [
    row.left.filter(item => enabled.has(item.metric)).length,
    row.right.filter(item => enabled.has(item.metric)).length,
  ]) : layout;
  const pending = segments.map(makeItem);
  const resolved = counts
    .map(([left, right]) => ({ left: pending.splice(0, left), right: pending.splice(0, right) }))
    .filter(row => row.left.length || row.right.length);
  if (pending.length) resolved.push({ left: pending, right: [] });
  return resolved.length ? resolved : [{ left: [], right: [] }];
}

export function presetBaseItem(preferences, metric) {
  const rows = PRESETS[preferences.preset]?.rows;
  if (!rows) return { metric };
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
