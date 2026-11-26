/**
 * Turn an agy status-line payload into ordered segment values.
 * Missing inputs produce no segment. Nothing here is invented.
 */

import { sanitizeText, truncateVisible } from "./ansi.mjs";

const DIR_LIMIT = 28;
const MODEL_LIMIT = 32;

export function collectSegments(payload, preferences, git = null) {
  const data = payload && typeof payload === "object" ? payload : {};
  const enabled = new Set(preferences.segments);
  const values = new Map();

  if (enabled.has("model")) {
    const model = readModel(data.model);
    if (model) values.set("model", { text: model, tone: "normal" });
  }
  if (enabled.has("dir")) {
    const dir = readDir(data);
    if (dir) values.set("dir", { text: dir, tone: "normal" });
  }
  if (enabled.has("git") && git) {
    values.set("git", {
      text: readGitText(git),
      tone: "normal",
      dirty: Boolean(git.dirty),
      git: true,
      gitAhead: git.ahead > 0,
      gitBehind: git.behind > 0,
    });
  }
  if (enabled.has("context")) {
    const context = readContext(data.context_window);
    if (context) values.set("context", context);
  }
  if (enabled.has("quota") || [...enabled].some(id => id.startsWith("quota."))) {
    const buckets = quotaBuckets(data.quota);
    const quota = readQuota(buckets);
    if (quota) values.set("quota", quota);
    for (const [id, seconds] of [["quota.5h", 18_000], ["quota.7d", 604_800]]) {
      const bucket = buckets.find(item => item.window === seconds);
      if (!bucket) continue;
      const gauge = 100 - bucket.pct;
      const pace = bucket.reset == null ? null : Math.max(0, Math.min(100, 100 * (1 - bucket.reset / seconds)));
      values.set(id, { text: `${id.slice(6)} ${gauge}%`, tone: quotaTone(bucket.pct), gauge, pace });
    }
    const eta = buckets.map(bucket => {
      if (!bucket.window || bucket.reset == null || bucket.pct >= 100) return null;
      const elapsed = bucket.window - bucket.reset;
      const untilEmpty = elapsed * bucket.pct / (100 - bucket.pct);
      return elapsed > 0 && untilEmpty < bucket.reset ? untilEmpty : null;
    }).filter(duration => duration !== null);
    if (eta.length) values.set("quota.eta", { text: `ETA ${durationText(Math.min(...eta))}`, tone: "warn" });
  }
  if (enabled.has("cache")) {
    const cache = readCache(data.context_window?.current_usage);
    if (cache) values.set("cache", cache);
  }
  if (enabled.has("worktree") && git?.worktree) {
    values.set("worktree", { text: sanitizeText(git.worktree), tone: "normal" });
  }
  if (enabled.has("cost")) {
    const cost = readCost(data.cost);
    if (cost) values.set("cost", { text: cost, tone: "normal" });
  }
  if (enabled.has("state")) {
    const state = readState(data.agent_state);
    if (state) values.set("state", { text: state, tone: stateTone(state) });
  }
  if (enabled.has("cycle")) {
    const cycle = readLabel(data.cycle_mode);
    if (cycle) values.set("cycle", { text: cycle, tone: "normal" });
  }
  if (enabled.has("sandbox")) {
    const sandbox = readSandbox(data.sandbox);
    if (sandbox) values.set("sandbox", { text: sandbox, tone: sandbox === "off" ? "warn" : "normal" });
  }
  if (enabled.has("vcs")) {
    const vcs = readVcs(data.vcs);
    if (vcs) values.set("vcs", { text: vcs, tone: "normal" });
  }

  return preferences.segments
    .filter((id) => values.has(id))
    .map((id) => ({ id, ...values.get(id) }));
}

function readModel(model) {
  if (!model || typeof model !== "object") return "";
  const name = sanitizeText(model.display_name || model.id || "").trim();
  if (!name) return "";
  const effort = sanitizeText(model.effort || "").trim();
  const lower = name.toLowerCase();
  const tier = effort.toLowerCase();
  const includesEffort = lower.endsWith(`(${tier})`) || lower.endsWith(` ${tier}`);
  return truncateVisible(effort && !includesEffort ? `${name} ${effort}` : name, MODEL_LIMIT);
}

function readDir(data) {
  const workspace = data.workspace && typeof data.workspace === "object" ? data.workspace : {};
  const raw = workspace.current_dir || workspace.project_dir || data.cwd || "";
  const text = sanitizeText(raw).trim();
  if (!text) return "";
  return truncateVisible(shortenPath(text), DIR_LIMIT);
}

function shortenPath(text) {
  const home = process.env.HOME;
  let value = text;
  if (home && (value === home || value.startsWith(`${home}/`))) {
    value = `~${value.slice(home.length)}`;
  }
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value.endsWith("/") && parts.length ? value : parts.join("/") || value;
  return `${parts[0] === "~" ? "~" : parts[0]}/\u2026/${parts[parts.length - 1]}`;
}

function readGitText(git) {
  return sanitizeText(git.branch || "").trim();
}

function readContext(window) {
  if (!window || typeof window !== "object") return null;
  const input = numberOrNull(window.total_input_tokens ?? window.current_usage?.input_tokens ?? window.current_usage);
  const output = numberOrNull(window.total_output_tokens ?? window.current_usage?.output_tokens);
  const tokens = input == null && output == null ? null : Math.max(0, (input ?? 0) + (output ?? 0));
  const size = numberOrNull(window.context_window_size);
  const calculated = tokens != null && size > 0 ? 100 * tokens / size : null;
  const pct = readPercent(window.used_percentage ?? calculated);
  if (pct == null) return null;
  const tone = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "normal";
  return { text: `${pct}%`, tone, gauge: pct, tokens };
}

function readCache(usage) {
  if (!usage || typeof usage !== "object") return null;
  const read = numberOrNull(usage.cache_read_input_tokens);
  const created = numberOrNull(usage.cache_creation_input_tokens);
  if (read == null && created == null) return null;
  const parts = [];
  if (read != null) parts.push(`${compactCount(read)} read`);
  if (created > 0) parts.push(`${compactCount(created)} created`);
  if (!parts.length) parts.push("0 created");
  return { text: `cache ${parts.join(" · ")}`, tone: "normal" };
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

function durationText(seconds) {
  if (seconds < 60) return "<1m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function quotaTone(pct) {
  return pct <= 10 ? "bad" : pct <= 30 ? "warn" : "normal";
}

function readQuota(buckets) {
  if (buckets.length === 0) return null;
  const remaining = Math.min(...buckets.map(bucket => bucket.pct));
  const text = buckets
    .map((bucket) => (bucket.label ? `${bucket.label} ${bucket.pct}%` : `${bucket.pct}%`))
    .join(" ");
  return { text: truncateVisible(text, 36), tone: quotaTone(remaining) };
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
