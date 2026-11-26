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
  if (enabled.has("quota")) {
    const quota = readQuota(data);
    if (quota) values.set("quota", quota);
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
  const pct = readPercent(window.used_percentage);
  if (pct == null) {
    const used = numberOrNull(window.current_usage);
    const size = numberOrNull(window.context_window_size);
    if (used == null || !size) return null;
    return gauge(Math.max(0, Math.min(100, Math.round((used / size) * 100))));
  }
  return gauge(pct);
}

function gauge(pct) {
  const tone = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "normal";
  return { text: `${pct}%`, tone, gauge: pct };
}

function readQuota(data) {
  const buckets = [];
  const push = (label, fraction) => {
    const pct = fractionToPercent(fraction);
    if (pct == null) return;
    buckets.push({ label: sanitizeText(label || "").trim(), pct });
  };
  if (Array.isArray(data.quota)) {
    for (const bucket of data.quota) {
      if (!bucket || typeof bucket !== "object") continue;
      push(bucket.label || bucket.name || bucket.id || "", bucket.remaining_fraction);
    }
  } else if (data.quota && typeof data.quota === "object") {
    if ("remaining_fraction" in data.quota) {
      push(data.quota.label || data.quota.name || "", data.quota.remaining_fraction);
    } else {
      for (const [key, value] of Object.entries(data.quota)) {
        if (value && typeof value === "object" && "remaining_fraction" in value) {
          push(value.label || value.name || key, value.remaining_fraction);
        }
      }
    }
  }
  if (buckets.length === 0) return null;
  const worst = buckets.reduce((min, bucket) => (bucket.pct < min.pct ? bucket : min));
  const text = buckets
    .map((bucket) => (bucket.label ? `${bucket.label} ${bucket.pct}%` : `${bucket.pct}%`))
    .join(" ");
  const tone = worst.pct <= 10 ? "bad" : worst.pct <= 30 ? "warn" : "normal";
  return { text: truncateVisible(text, 36), tone };
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
  const pct = number <= 1 && number > 0 ? Math.round(number * 100) : Math.round(number);
  return Math.max(0, Math.min(100, pct));
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
