/**
 * Turn an agy status-line payload into ordered segment values.
 * Missing inputs produce no segment. Nothing here is invented.
 */

import { sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
import {
  CACHE_TTL_1H,
  CACHE_TTL_5M,
  SUBAGENT_DONE_SHOW_MS,
  estimateRewarmUsd,
  formatMoney,
  formatUsdToday,
  normalizeSubagentStatus,
} from "./telemetry.mjs";

const DIR_LIMIT = 28;
const MODEL_LIMIT = 32;
const SUBAGENT_ROLE_LIMIT = 32;
const SUBAGENT_MODEL_LIMIT = 28;

export function collectSegments(payload, preferences, git = null, { now = Date.now(), home = process.env.HOME, telemetry = null } = {}) {
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
      const paceRole = paceDelta == null ? null : paceDelta === 0 ? "muted" : paceDelta > 0 ? "bad" : "good";
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
        ...(paceRole ? { fieldRoles: { pace: paceRole, arrow: paceRole } } : {}),
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
    const cache = readCache(data, telemetry?.cache ?? null, now);
    if (cache) values.set("cache", cache);
  }
  if (enabled.has("worktree") && git?.worktree) {
    const name = sanitizeText(git.worktree);
    values.set("worktree", { text: name, tone: "normal", fields: { name } });
  }
  if (enabled.has("cost")) {
    const cost = readCost(data.cost) || (telemetry?.sessionCostUsd > 0 ? readCost({ total_usd: telemetry.sessionCostUsd }) : "");
    if (cost) values.set("cost", { text: cost, tone: "normal", fields: { usd: cost } });
  }
  if (enabled.has("cost.today")) {
    const today = readTodayCost(data.cost_today ?? telemetry?.todayCost);
    if (today) values.set("cost.today", today);
  }
  if (enabled.has("tps")) {
    const tps = readTps(data.tps ?? telemetry?.tps);
    if (tps) values.set("tps", tps);
  }
  if (enabled.has("state")) {
    const state = readState(data.agent_state);
    if (state) values.set("state", { text: state, tone: stateTone(state), fields: { state, status: state } });
  }
  if (enabled.has("subagents")) {
    const subagents = readSubagents(data.subagents, telemetry?.subagents ?? null, now);
    if (subagents) values.set("subagents", subagents);
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

function readCache(data, telemetryCache = null, now = Date.now()) {
  const pc = data.prompt_cache && typeof data.prompt_cache === "object"
    ? data.prompt_cache
    : (telemetryCache && typeof telemetryCache === "object" ? telemetryCache : null);
  if (pc?.caching_observed === false) return null;

  const usage = data.context_window?.current_usage && typeof data.context_window.current_usage === "object"
    ? data.context_window.current_usage
    : null;
  const readTokens = numberOrNull(usage?.cache_read_input_tokens ?? pc?.last_read);
  const createdTokens = numberOrNull(usage?.cache_creation_input_tokens ?? pc?.last_created);
  const inputTokens = numberOrNull(usage?.input_tokens);

  if (!pc && readTokens == null && createdTokens == null) return null;

  const readText = readTokens != null ? compactCount(readTokens) : null;
  const createdText = createdTokens > 0 ? compactCount(createdTokens) : (readTokens == null && createdTokens != null ? "0" : null);

  const ttlStr = typeof pc?.ttl === "string" && pc.ttl.trim() ? sanitizeText(pc.ttl).trim() : null;
  const ttlSec = ttlStr === "1h" ? CACHE_TTL_1H : CACHE_TTL_5M;
  const hasWarmCold = Boolean(pc && (pc.warm != null || pc.expires_at != null || pc.expires_in_seconds != null));

  let left = null;
  let cold = null;
  let state = null;
  let gauge = null;
  let tone = "normal";

  if (hasWarmCold) {
    const expiresAt = numberOrNull(pc.expires_at);
    const rawLeft = expiresAt != null
      ? Math.floor(expiresAt - now / 1000)
      : numberOrNull(pc.expires_in_seconds);
    const leftSec = rawLeft != null && rawLeft > 0 && pc.warm !== false ? Math.floor(rawLeft) : null;
    if (leftSec != null) {
      left = cacheCountdownText(leftSec);
      state = "warm";
      gauge = Math.max(0, Math.min(100, Math.round((leftSec / ttlSec) * 100)));
      const warnThreshold = Math.max(60, Math.min(300, Math.floor(ttlSec / 5)));
      tone = leftSec < warnThreshold ? "warn" : "normal";
    } else {
      cold = "cold";
      state = "cold";
      gauge = 0;
      tone = "warn";
    }
  }

  let hit = null;
  if (pc && pc.hit_ratio != null) {
    const rawHit = numberOrNull(pc.hit_ratio);
    const requests = numberOrNull(pc.requests);
    if (rawHit != null && (requests == null || requests > 1)) {
      const ratio = rawHit > 1 ? rawHit / 100 : rawHit;
      hit = formatCachePercent(ratio);
    }
  } else if (readTokens != null && inputTokens != null) {
    const denom = inputTokens + readTokens + (createdTokens ?? 0);
    if (denom > 0 && (readTokens > 0 || !(createdTokens > 0))) {
      hit = formatCachePercent(readTokens / denom);
    }
  }

  if (gauge == null && hit != null) {
    gauge = Number(hit);
  }

  const missesNum = numberOrNull(pc?.misses);
  const misses = missesNum != null && missesNum > 0 ? String(Math.round(missesNum)) : null;

  const rawCause = pc?.last_miss_cause && typeof pc.last_miss_cause === "object"
    ? pc.last_miss_cause.causes?.[0]
    : (pc?.last_miss_cause ?? pc?.cause);
  const cause = rawCause ? sanitizeText(String(rawCause)).replaceAll("_", " ").trim() || null : null;

  let rewarmUsd = numberOrNull(pc?.rewarm_usd);
  if (rewarmUsd == null) {
    const recacheTokens = numberOrNull(pc?.recache_tokens_if_cold)
      ?? (inputTokens != null ? inputTokens + (readTokens ?? 0) + (createdTokens ?? 0) : null);
    const modelNames = [data.model?.id, data.model?.display_name, pc?.model].filter(Boolean).join(" ");
    if (recacheTokens > 0 && modelNames) {
      rewarmUsd = estimateRewarmUsd(recacheTokens, modelNames, ttlStr ?? "5m", now);
    }
  }
  const rewarm = rewarmUsd != null ? formatMoney(rewarmUsd) : null;

  let text;
  if (left || cold) {
    text = `${left ?? cold}${hit != null ? ` · ${hit}% hit` : ""}`;
  } else if (hit != null) {
    text = `${hit}% hit`;
  } else {
    const parts = [];
    if (readText != null) parts.push(`${readText} read`);
    if (createdText != null) parts.push(`${createdText} created`);
    text = `cache ${parts.join(" · ")}`;
  }

  return {
    text,
    tone,
    ...(gauge != null ? { gauge } : {}),
    fields: {
      left,
      cold,
      rewarm,
      state,
      ttl: ttlStr,
      hit,
      misses,
      cause,
      read: readText,
      created: createdText,
    },
  };
}

function formatCachePercent(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const pct = Math.round(clamped * 100);
  if (pct === 0 && clamped > 0) return "1";
  return String(pct);
}

export function cacheCountdownText(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  if (total < 3_600) {
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
  if (total < 86_400) {
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  return `${days}d${hours}h`;
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

function readTodayCost(source) {
  if (!source || typeof source !== "object") return null;
  const total = numberOrNull(source.total_usd ?? source.usd);
  const calls = numberOrNull(source.calls);
  const convs = numberOrNull(source.conversations ?? source.convs);
  if (total == null) return null;
  if (total <= 0 && !(calls > 0)) return null;
  const usd = formatUsdToday(total);
  return {
    text: `${usd} today`,
    tone: "normal",
    fields: {
      usd,
      calls: calls != null && calls > 0 ? String(Math.round(calls)) : null,
      convs: convs != null && convs > 0 ? String(Math.round(convs)) : null,
    },
  };
}

function readTps(source) {
  if (!source || typeof source !== "object") return null;
  const rate = numberOrNull(source.rate ?? source.tps);
  if (rate == null || !(rate > 0)) return null;
  const rounded = Math.round(rate);
  const ttft = numberOrNull(source.ttft);
  const total = numberOrNull(source.total);
  const median = numberOrNull(source.median);
  const out = numberOrNull(source.output_tokens ?? source.out);
  return {
    text: `${rounded} tok/s`,
    tone: rate < 30 ? "warn" : "normal",
    fields: {
      tps: String(rounded),
      ttft: ttft != null && ttft > 0 ? `${ttft.toFixed(1)}s` : null,
      total: total != null && total > 0 ? `${total.toFixed(1)}s` : null,
      median: median != null && median > 0 ? String(Math.round(median)) : null,
      out: out != null && out > 0 ? compactCount(out) : null,
    },
  };
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

export function formatSubagentDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3_600) {
    return `${Math.floor(totalSec / 60)}m${String(totalSec % 60).padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalSec / 3_600);
  const mins = Math.floor((totalSec % 3_600) / 60);
  return `${hours}h${String(mins).padStart(2, "0")}m`;
}

function clipEllipsis(text, max) {
  const clean = sanitizeText(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (visibleWidth(clean) <= max) return clean;
  if (max <= 1) return truncateVisible(clean, max);
  return `${truncateVisible(clean, max - 1)}…`;
}

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 946_684_800_000) return value;
    if (value > 946_684_800) return value * 1000;
    return 0;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    if (Number.isFinite(parsed) && parsed > 946_684_800_000) return parsed;
  }
  return 0;
}

function cleanSubagentModel(rawModel) {
  if (!rawModel) return null;
  let text = "";
  if (typeof rawModel === "string") {
    text = sanitizeText(rawModel).trim();
  } else if (typeof rawModel === "object") {
    const parsed = readModel(rawModel);
    text = parsed?.text || "";
  }
  if (!text || text === "unknown" || /(?:PLACEHOLDER|MODEL_)/i.test(text)) return null;
  return clipEllipsis(text, SUBAGENT_MODEL_LIMIT);
}

function normalizePayloadSubagent(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const id = sanitizeText(raw.conversation_id || raw.id || "").trim() || null;
  const typeName = sanitizeText(raw.type_name || raw.typeName || raw.name || raw.agent_name || "").trim() || "subagent";
  const rawRole = sanitizeText(raw.role || raw.title || "").trim();
  const model = cleanSubagentModel(raw.model);

  let contextPct = readPercent(raw.context_pct ?? raw.contextPct);
  let contextTokens = numberOrNull(raw.context_tokens ?? raw.contextTokens);
  if (raw.context_window && typeof raw.context_window === "object") {
    const ctx = readContext(raw.context_window);
    if (ctx) {
      if (contextPct == null) contextPct = ctx.gauge;
      if (contextTokens == null) contextTokens = ctx.tokens;
    } else {
      const u = raw.context_window.current_usage;
      const inp = numberOrNull(u?.input_tokens ?? u);
      const cr = numberOrNull(u?.cache_read_input_tokens);
      const cw = numberOrNull(u?.cache_creation_input_tokens);
      if (contextTokens == null && (inp != null || cr != null || cw != null)) {
        contextTokens = Math.max(0, (inp ?? 0) + (cr ?? 0) + (cw ?? 0));
      }
    }
  }

  let cacheHit = null;
  const rawHit = numberOrNull(raw.cache_hit ?? raw.cacheHit ?? raw.hit_ratio);
  if (rawHit != null) {
    const ratio = rawHit > 1 ? rawHit / 100 : rawHit;
    if (ratio > 0) cacheHit = Number(formatCachePercent(ratio));
  }

  const rawCost = numberOrNull(raw.cost_usd ?? raw.costUsd ?? raw.cost?.total_usd);
  const costUsd = rawCost != null && rawCost > 0 ? rawCost : null;
  const status = normalizeSubagentStatus(raw.status, raw.killed);
  const rawSteps = numberOrNull(raw.steps ?? raw.step_count);
  const steps = rawSteps != null && rawSteps > 0 ? Math.round(rawSteps) : null;
  const startedAt = parseTimestampMs(raw.started_at ?? raw.startedAt);
  const endedAt = parseTimestampMs(raw.ended_at ?? raw.endedAt ?? raw.completed_at ?? raw.completedAt);
  let durationMs = numberOrNull(raw.duration_ms ?? raw.durationMs);
  if (durationMs == null) {
    const durSec = numberOrNull(raw.elapsed_seconds ?? raw.duration_seconds);
    if (durSec != null && durSec >= 0) durationMs = durSec * 1000;
  }

  return {
    id,
    typeName,
    rawRole,
    model,
    contextPct,
    contextTokens,
    cacheHit,
    costUsd,
    status,
    steps,
    startedAt,
    endedAt,
    durationMs,
    lastAt: endedAt || startedAt || 0,
    fromPayload: true,
    order: index,
  };
}

function normalizeTelemetrySubagent(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const id = sanitizeText(raw.id || "").trim() || null;
  const typeName = sanitizeText(raw.typeName || raw.agentName || "").trim() || "subagent";
  const rawRole = sanitizeText(raw.role || raw.title || "").trim();
  const model = cleanSubagentModel(raw.model);
  const contextPct = readPercent(raw.contextPct);
  const contextTokens = numberOrNull(raw.contextTokens);
  const rawHit = numberOrNull(raw.cacheHit);
  const cacheHit = rawHit != null && rawHit > 0 ? Math.max(1, Math.min(100, Math.round(rawHit))) : null;
  const rawCost = numberOrNull(raw.costUsd);
  const costUsd = rawCost != null && rawCost > 0 ? rawCost : null;
  const status = normalizeSubagentStatus(raw.status);
  const rawSteps = numberOrNull(raw.steps);
  const steps = rawSteps != null && rawSteps > 0 ? Math.round(rawSteps) : null;
  const startedAt = parseTimestampMs(raw.startedAt);
  const endedAt = parseTimestampMs(raw.endedAt);
  const durationMs = numberOrNull(raw.durationMs);
  const lastAt = parseTimestampMs(raw.lastAt) || endedAt || startedAt || 0;

  return {
    id,
    typeName,
    rawRole,
    model,
    contextPct,
    contextTokens,
    cacheHit,
    costUsd,
    status,
    steps,
    startedAt,
    endedAt,
    durationMs,
    lastAt,
    fromPayload: false,
    order: index,
  };
}

function readSubagents(payloadSubagents, telemetrySubagents = null, now = Date.now()) {
  const payloadList = Array.isArray(payloadSubagents)
    ? payloadSubagents.map(normalizePayloadSubagent).filter(Boolean)
    : [];
  const telList = Array.isArray(telemetrySubagents)
    ? telemetrySubagents.map((entry, idx) => normalizeTelemetrySubagent(entry, payloadList.length + idx)).filter(Boolean)
    : [];

  if (payloadList.length === 0 && telList.length === 0) return null;

  const usedTel = new Set();
  const matchTelemetry = (item) => {
    if (item.id) {
      const byId = telList.findIndex((t, idx) => !usedTel.has(idx) && t.id === item.id);
      if (byId >= 0) return byId;
    }
    const wantType = item.typeName.toLowerCase();
    const wantRole = item.rawRole.toLowerCase();
    if (wantRole) {
      const byBoth = telList.findIndex((t, idx) => (
        !usedTel.has(idx)
        && t.typeName.toLowerCase() === wantType
        && t.rawRole.toLowerCase() === wantRole
      ));
      if (byBoth >= 0) return byBoth;
    }
    const byType = telList.findIndex((t, idx) => !usedTel.has(idx) && t.typeName.toLowerCase() === wantType);
    return byType;
  };

  const merged = [];
  for (const item of payloadList) {
    const idx = matchTelemetry(item);
    if (idx >= 0) {
      usedTel.add(idx);
      const t = telList[idx];
      const status = item.status === "running" && t.status === "waiting" ? "waiting" : item.status;
      merged.push({
        ...t,
        ...item,
        id: item.id ?? t.id,
        typeName: item.typeName || t.typeName,
        rawRole: item.rawRole || t.rawRole,
        model: item.model ?? t.model,
        contextPct: item.contextPct ?? t.contextPct,
        contextTokens: item.contextTokens ?? t.contextTokens,
        cacheHit: item.cacheHit ?? t.cacheHit,
        costUsd: item.costUsd ?? t.costUsd,
        status,
        steps: item.steps ?? t.steps,
        startedAt: item.startedAt || t.startedAt,
        endedAt: item.endedAt || t.endedAt,
        durationMs: item.durationMs ?? t.durationMs,
        lastAt: item.lastAt || t.lastAt,
        fromPayload: true,
      });
    } else {
      merged.push(item);
    }
  }
  telList.forEach((t, idx) => {
    if (!usedTel.has(idx)) merged.push(t);
  });

  const visible = [];
  for (const item of merged) {
    const active = item.status === "running" || item.status === "waiting";
    if (!active) {
      if (item.endedAt > 0 && now - item.endedAt >= SUBAGENT_DONE_SHOW_MS) continue;
      if (!item.fromPayload && !(item.endedAt > 0)) continue;
    }
    let durationMs = item.durationMs;
    if (durationMs == null) {
      if (active && item.startedAt > 0 && now >= item.startedAt) {
        durationMs = now - item.startedAt;
      } else if (!active && item.startedAt > 0 && item.endedAt > item.startedAt) {
        durationMs = item.endedAt - item.startedAt;
      }
    }
    const role = item.rawRole && item.rawRole.toLowerCase() !== item.typeName.toLowerCase()
      ? clipEllipsis(item.rawRole, SUBAGENT_ROLE_LIMIT)
      : null;
    visible.push({
      id: item.id,
      typeName: item.typeName,
      role,
      model: item.model,
      contextPct: item.contextPct,
      contextTokens: item.contextTokens,
      cacheHit: item.cacheHit,
      costUsd: item.costUsd,
      status: item.status,
      steps: item.steps,
      durationMs: durationMs != null && durationMs >= 0 ? durationMs : null,
      lastAt: item.lastAt,
      order: item.order,
    });
  }

  if (visible.length === 0) return null;

  const isActive = (entry) => entry.status === "running" || entry.status === "waiting";
  visible.sort((a, b) => (
    (Number(isActive(b)) - Number(isActive(a)))
    || (b.lastAt - a.lastAt)
    || (a.order - b.order)
  ));

  const runningCount = visible.filter((s) => s.status === "running").length;
  const waitingCount = visible.filter((s) => s.status === "waiting").length;
  const doneCount = visible.filter((s) => s.status === "done").length;
  const activeCount = runningCount + waitingCount;
  const totalCost = visible.reduce((sum, s) => sum + (s.costUsd || 0), 0);
  const topNames = visible.slice(0, 2).map((s) => s.typeName);
  const names = visible.length > 2 ? `${topNames.join(", ")}, +${visible.length - 2}` : topNames.join(", ");

  const summaryParts = [];
  if (runningCount > 0) summaryParts.push(`${runningCount} running`);
  if (waitingCount > 0) summaryParts.push(`${waitingCount} waiting`);
  if (doneCount > 0) summaryParts.push(`${doneCount} done`);
  const text = summaryParts.length ? summaryParts.join(" · ") : `${visible.length} subagents`;
  const tone = waitingCount > 0 ? "warn" : runningCount > 0 ? "normal" : "muted";

  return {
    text,
    tone,
    subagents: visible,
    fields: {
      running: runningCount > 0 ? String(runningCount) : null,
      waiting: waitingCount > 0 ? String(waitingCount) : null,
      done: doneCount > 0 ? String(doneCount) : null,
      active: activeCount > 0 ? String(activeCount) : null,
      total: String(visible.length),
      names: names || null,
      cost: totalCost > 0 ? formatUsdToday(totalCost) : null,
    },
  };
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
