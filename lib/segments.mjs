/**
 * Turn an agy status-line payload into ordered segment values.
 * Missing inputs produce no segment. Nothing here is invented.
 */

import { sanitizeText, truncateVisible } from "./ansi.mjs";

const DIR_LIMIT = 28;
const MODEL_LIMIT = 32;

export function collectSegments(payload, preferences, git = null, { now = Date.now(), home = process.env.HOME } = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const enabled = new Set(preferences.segments);
  const values = new Map();

  if (enabled.has("model")) {
    const model = readModel(data.model);
    if (model) values.set("model", model);
  }
  if (enabled.has("dir")) {
    const dir = readDir(data, preferences.dirStyle ?? "auto", home);
    if (dir) values.set("dir", dir);
  }
  if (enabled.has("git") && git) {
    values.set("git", readGitSegment(git));
  }
  if (enabled.has("context")) {
    const context = readContext(data.context_window);
    if (context) values.set("context", context);
  }
  if (enabled.has("quota") || [...enabled].some(id => id.startsWith("quota."))) {
    const buckets = quotaBuckets(data.quota);
    const quota = readQuota(buckets, now);
    if (quota) values.set("quota", quota);
    for (const [id, seconds] of [["quota.5h", 18_000], ["quota.7d", 604_800]]) {
      const bucket = buckets.find(item => item.window === seconds);
      if (!bucket) continue;
      const gauge = 100 - bucket.pct;
      const pace = bucket.reset == null ? null : Math.max(0, Math.min(100, 100 * (1 - bucket.reset / seconds)));
      const paceDelta = pace == null ? null : Math.round(gauge - pace);
      const resetLeft = bucket.reset == null ? null : countdownText(bucket.reset);
      const resetClock = bucket.reset == null ? null : formatResetClock(bucket.reset, now);
      const signedPace = paceDelta == null ? null : paceDelta > 0 ? `+${paceDelta}%` : `${paceDelta}%`;
      values.set(id, {
        text: `${id.slice(6)} ${gauge}%`,
        tone: quotaTone(bucket.pct),
        gauge,
        pace,
        paceDelta,
        reset: bucket.reset,
        fields: {
          pct: String(gauge),
          reset: resetClock,
          left: resetLeft,
          pace: signedPace,
          arrow: paceDelta == null ? null : paceArrow(paceDelta, "unicode"),
        },
      });
    }
    const eta = buckets.map(bucket => {
      if (!bucket.window || bucket.reset == null || bucket.pct >= 100) return null;
      const elapsed = bucket.window - bucket.reset;
      const untilEmpty = elapsed * bucket.pct / (100 - bucket.pct);
      return elapsed > 0 && untilEmpty < bucket.reset ? untilEmpty : null;
    }).filter(duration => duration !== null);
    if (eta.length) {
      const left = countdownText(Math.min(...eta));
      values.set("quota.eta", { text: `ETA ${left}`, tone: "warn", fields: { left } });
    }
  }
  if (enabled.has("cache")) {
    const cache = readCache(data.context_window?.current_usage);
    if (cache) values.set("cache", cache);
  }
  if (enabled.has("worktree") && git?.worktree) {
    const name = sanitizeText(git.worktree);
    values.set("worktree", { text: name, tone: "normal", fields: { name } });
  }
  if (enabled.has("cost")) {
    const cost = readCost(data.cost);
    if (cost) values.set("cost", { text: cost, tone: "normal", fields: { usd: cost } });
  }
  if (enabled.has("state")) {
    const state = readState(data.agent_state);
    if (state) values.set("state", { text: state, tone: stateTone(state), fields: { state, status: state } });
  }
  if (enabled.has("cycle")) {
    const cycle = readLabel(data.cycle_mode);
    if (cycle) values.set("cycle", { text: cycle, tone: "normal", fields: { mode: cycle, cycle } });
  }
  if (enabled.has("sandbox")) {
    const sandbox = readSandbox(data.sandbox);
    if (sandbox) values.set("sandbox", { text: sandbox, tone: sandbox === "off" ? "warn" : "normal", fields: { state: sandbox, sandbox } });
  }
  if (enabled.has("vcs")) {
    const vcs = readVcs(data.vcs);
    if (vcs) values.set("vcs", { text: vcs, tone: "normal", fields: { type: vcs, vcs } });
  }

  return preferences.segments
    .filter((id) => values.has(id))
    .map((id) => ({ id, ...values.get(id) }));
}

export function paceArrow(delta, icons = "unicode") {
  if (icons === "ascii") {
    return delta > 0 ? `+${delta}%` : delta < 0 ? `-${Math.abs(delta)}%` : "0%";
  }
  return delta > 0 ? `⇡${delta}%` : delta < 0 ? `⇣${Math.abs(delta)}%` : "±0%";
}

function readModel(model) {
  if (!model || typeof model !== "object") return null;
  const rawName = sanitizeText(model.display_name || model.id || "").trim();
  if (!rawName) return null;
  const id = sanitizeText(model.id || "").trim();
  const effort = sanitizeText(model.effort || "").trim();
  const lower = rawName.toLowerCase();
  const tier = effort.toLowerCase();
  const includesEffort = lower.endsWith(`(${tier})`) || lower.endsWith(` ${tier}`);
  const displayEffort = effort && !includesEffort ? effort : null;
  const name = truncateVisible(rawName, MODEL_LIMIT);
  const text = truncateVisible(displayEffort ? `${rawName} ${displayEffort}` : rawName, MODEL_LIMIT);
  const family = rawName.split(/\s+/)[0] || rawName;
  return {
    text,
    tone: "normal",
    fields: { name, family, id: id || null, effort: displayEffort },
  };
}

function readDir(data, style = "auto", home = process.env.HOME) {
  const workspace = data.workspace && typeof data.workspace === "object" ? data.workspace : {};
  const raw = workspace.current_dir || workspace.project_dir || data.cwd || "";
  const text = sanitizeText(raw).trim();
  if (!text) return null;
  const normalized = stripTrailingSlash(text);
  const styles = {
    name: formatDirPath(normalized, "name", { home }),
    parent: formatDirPath(normalized, "parent", { home }),
    tilde: formatDirPath(normalized, "tilde", { home }),
    short: formatDirPath(normalized, "short", { home }),
    full: formatDirPath(normalized, "full", { home }),
  };
  const shown = formatDirPath(normalized, style, { home });
  return {
    text: shown,
    tone: "normal",
    fields: { path: shown, ...styles },
  };
}

export function formatDirPath(rawPath, style = "auto", { home = process.env.HOME } = {}) {
  const text = stripTrailingSlash(sanitizeText(rawPath).trim());
  if (!text) return "";
  const tilde = replaceHome(text, home);
  const parts = text.split(/[\\/]/).filter(Boolean);
  const name = parts.at(-1) || "/";
  if (style === "full") return text;
  if (style === "tilde") return tilde;
  if (style === "name") return name;
  if (style === "parent") return parts.length >= 2 ? parts.slice(-2).join("/") : name;
  if (style === "short") {
    const sep = tilde.includes("\\") && !tilde.includes("/") ? "\\" : "/";
    const segments = tilde.split(/[\\/]/);
    return segments.map((part, index) => {
      if (index === segments.length - 1 || !part || part === "~") return part;
      return part.startsWith(".") ? part.slice(0, 2) : part.slice(0, 1);
    }).join(sep);
  }
  return truncateVisible(shortenPath(text, home), DIR_LIMIT);
}

function stripTrailingSlash(text) {
  if (text.length <= 1) return text;
  return text.replace(/[\\/]+$/, "") || "/";
}

function replaceHome(text, home) {
  if (!home) return text;
  const cleanHome = stripTrailingSlash(home);
  if (text === cleanHome) return "~";
  if (text.startsWith(`${cleanHome}/`) || text.startsWith(`${cleanHome}\\`)) {
    return `~${text.slice(cleanHome.length)}`;
  }
  return text;
}

function shortenPath(text, home = process.env.HOME) {
  const value = replaceHome(text, home);
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value.endsWith("/") && parts.length ? value : parts.join("/") || value;
  return `${parts[0] === "~" ? "~" : parts[0]}/\u2026/${parts[parts.length - 1]}`;
}

function readGitSegment(git) {
  const branch = sanitizeText(git.branch || "").trim();
  const sha = sanitizeText(git.sha || "").trim().slice(0, 7) || null;
  const ahead = Number(git.ahead) > 0 ? Number(git.ahead) : 0;
  const behind = Number(git.behind) > 0 ? Number(git.behind) : 0;
  const staged = Number(git.staged) > 0 ? Number(git.staged) : 0;
  const modified = Number(git.modified) > 0 ? Number(git.modified) : 0;
  const untracked = Number(git.untracked) > 0 ? Number(git.untracked) : 0;
  const conflicts = Number(git.conflicts) > 0 ? Number(git.conflicts) : 0;
  const detached = Boolean(git.detached) || (Boolean(sha) && branch === sha);
  return {
    text: branch,
    tone: conflicts > 0 ? "bad" : "normal",
    dirty: Boolean(git.dirty),
    git: true,
    detached,
    sha,
    ahead,
    behind,
    gitAhead: ahead > 0,
    gitBehind: behind > 0,
    staged,
    modified,
    untracked,
    conflicts,
    fields: {
      branch,
      sha,
      staged: staged > 0 ? String(staged) : null,
      modified: modified > 0 ? String(modified) : null,
      untracked: untracked > 0 ? String(untracked) : null,
      conflicts: conflicts > 0 ? String(conflicts) : null,
    },
  };
}

function readContext(window) {
  if (!window || typeof window !== "object") return null;
  const current = window.current_usage;
  const currentInput = numberOrNull(current?.input_tokens ?? current);
  const currentOutput = numberOrNull(current?.output_tokens);
  const hasCurrent = currentInput != null || currentOutput != null;
  const input = hasCurrent ? currentInput : numberOrNull(window.total_input_tokens);
  const output = hasCurrent ? currentOutput : numberOrNull(window.total_output_tokens);
  const tokens = input == null && output == null ? null : Math.max(0, (input ?? 0) + (output ?? 0));
  const rawSize = numberOrNull(window.context_window_size);
  const size = rawSize != null && rawSize > 0 ? rawSize : null;
  const calculated = tokens != null && size != null ? 100 * tokens / size : null;
  const pct = readPercent(window.used_percentage ?? calculated);
  if (pct == null) return null;
  const tone = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "normal";
  const fields = {
    pct: String(pct),
    tokens: tokens != null ? compactCount(tokens) : null,
    window: size != null ? compactCount(size) : null,
    left: tokens != null && size != null ? compactCount(Math.max(0, size - tokens)) : null,
  };
  return { text: `${pct}%`, tone, gauge: pct, tokens, size, fields };
}

function readCache(usage) {
  if (!usage || typeof usage !== "object") return null;
  const read = numberOrNull(usage.cache_read_input_tokens);
  const created = numberOrNull(usage.cache_creation_input_tokens);
  if (read == null && created == null) return null;
  const parts = [];
  const readText = read != null ? compactCount(read) : null;
  const createdText = created > 0 ? compactCount(created) : read == null ? "0" : null;
  if (readText != null) parts.push(`${readText} read`);
  if (createdText != null) parts.push(`${createdText} created`);
  return {
    text: `cache ${parts.join(" · ")}`,
    tone: "normal",
    fields: { read: readText, created: createdText },
  };
}

export function compactCount(value) {
  if (value < 1_000) return String(Math.round(value));
  const divisor = value >= 1_000_000 ? 1_000_000 : 1_000;
  return `${Number((value / divisor).toFixed(1))}${divisor === 1_000_000 ? "M" : "k"}`;
}

function quotaBuckets(quota) {
  if (!quota || typeof quota !== "object") return [];
  const entries = Array.isArray(quota) ? quota.map(bucket => [bucket?.id, bucket])
    : "remaining_fraction" in quota ? [[quota.id, quota]] : Object.entries(quota);
  return entries.flatMap(([id, bucket]) => {
    if (!bucket || typeof bucket !== "object" || bucket.disabled) return [];
    const pct = fractionToPercent(bucket.remaining_fraction);
    if (pct == null) return [];
    const label = sanitizeText(bucket.label || bucket.name || id || "").trim();
    const names = `${id || ""} ${label}`.toLowerCase();
    const window = /(?:^|[^a-z0-9])(?:5h|5[-_ ]?hours?)(?:$|[^a-z0-9])/.test(names) ? 18_000
      : /(?:^|[^a-z0-9])(?:7d|weekly|7[-_ ]?days?)(?:$|[^a-z0-9])/.test(names) ? 604_800 : null;
    const reset = numberOrNull(bucket.reset_in_seconds);
    if (reset != null && reset <= 0) return [];
    return [{ label, pct, window, reset }];
  });
}

export function countdownText(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return "<1m";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3600) % 24;
  return `${days}d${hours}h`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatResetClock(resetSeconds, nowMs = Date.now()) {
  if (resetSeconds == null || !Number.isFinite(resetSeconds) || resetSeconds <= 0) return null;
  const now = new Date(nowMs);
  const at = new Date(nowMs + resetSeconds * 1000);
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dayDiff = Math.round((startOfTarget - startOfToday) / 86_400_000);
  if (dayDiff === 0) return hhmm;
  if (dayDiff > 0 && dayDiff < 7) return `${WEEKDAYS[at.getDay()]} ${hhmm}`;
  return `${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")} ${hhmm}`;
}

function quotaTone(pct) {
  return pct <= 10 ? "bad" : pct <= 30 ? "warn" : "normal";
}

function readQuota(buckets, now = Date.now()) {
  if (buckets.length === 0) return null;
  const remaining = Math.min(...buckets.map(bucket => bucket.pct));
  const resets = buckets.map(bucket => bucket.reset).filter(value => value != null && value > 0);
  const soonest = resets.length ? Math.min(...resets) : null;
  const text = truncateVisible(
    buckets.map((bucket) => (bucket.label ? `${bucket.label} ${bucket.pct}%` : `${bucket.pct}%`)).join(" "),
    36,
  );
  return {
    text,
    tone: quotaTone(remaining),
    fields: {
      text,
      pct: String(remaining),
      left: countdownText(soonest),
      reset: formatResetClock(soonest, now),
    },
  };
}

function readCost(cost) {
  if (!cost || typeof cost !== "object") return "";
  const total = numberOrNull(cost.total_usd);
  if (total == null) return "";
  const digits = total >= 10 ? 2 : total >= 1 ? 3 : 4;
  return `$${total.toFixed(digits)}`;
}

function readState(state) {
  if (state == null) return "";
  if (typeof state === "string") return sanitizeText(state).trim();
  if (typeof state === "object") {
    const label = state.label || state.name || state.status || state.phase || "";
    return sanitizeText(label).trim();
  }
  return "";
}

function stateTone(state) {
  const text = state.toLowerCase();
  if (/(error|fail|blocked)/.test(text)) return "bad";
  if (/(wait|idle|paused)/.test(text)) return "muted";
  return "normal";
}

function readLabel(value) {
  if (typeof value === "string") return sanitizeText(value).trim();
  if (value && typeof value === "object") return sanitizeText(value.label || value.name || "").trim();
  return "";
}

function readSandbox(sandbox) {
  if (!sandbox || typeof sandbox !== "object" || typeof sandbox.enabled !== "boolean") return "";
  return sandbox.enabled ? "on" : "off";
}

function readVcs(vcs) {
  if (!vcs || typeof vcs !== "object") return "";
  return sanitizeText(vcs.type || "").trim();
}

function readPercent(value) {
  const number = numberOrNull(value);
  if (number == null) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function fractionToPercent(value) {
  const number = numberOrNull(value);
  if (number == null) return null;
  const fraction = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
