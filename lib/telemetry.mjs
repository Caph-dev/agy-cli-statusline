/**
 * Read local Antigravity conversation SQLite databases (read-only) to compute
 * generation speed (TPS) and today's estimated API-list cost.
 *
 * Protobuf field numbers, pricing table, and TPS/cost formulas are adapted from
 * agy-zh-pack (MIT). See THIRD_PARTY_NOTICES.md.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { configRoot, ENV_HOME, runtimeDir } from "./paths.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db$/i;
const CACHE_VERSION = 2;

export const SPEED_MIN_OUT = 100;
export const SPEED_MIN_SEC = 0.3;
export const SPEED_MIN_SAMPLES = 3;
export const CACHE_TTL_5M = 300;
export const CACHE_TTL_1H = 3_600;
export const CACHE_MISS_MIN_TOKENS = 20_000;
export const CACHE_MISS_IDLE_MS = 60_000;
export const SUBAGENT_MAX_ROWS = 4;
export const SUBAGENT_DONE_SHOW_MS = 10_000;

const PT0 = (date) => Date.parse(`${date}T08:00:00Z`);

const P_CARBON = [
  [PT0("2026-12-01"), { in: 2, cache: 0.1, out: 10 }],
  [Infinity, { in: 4, cache: 0.2, out: 20 }],
];
const P_NEON = [[Infinity, { in: 3, cache: 0.15, out: 15 }]];
const P_HYDROGEN = [[Infinity, { in: 1.5, cache: 0.075, out: 7.5 }]];
const P_FLASH_3X = [
  [PT0("2027-01-01"), { in: 0.75, cache: 0.075, out: 3.75 }],
  [Infinity, { in: 1.5, cache: 0.15, out: 7.5 }],
];

// Prices in USD per 1M tokens (standard API list prices; adapted from agy-zh-pack).
export const PRICES = [
  { re: /orchestrator-neon/i, name: "Neon", t: P_NEON },
  { re: /orchestrator-argon/i, name: "Argon", t: P_CARBON },
  { re: /orchestrator/i, name: "Carbon", t: P_CARBON },
  { re: /flash-worker/i, name: "Hydrogen", t: P_HYDROGEN },
  { re: /gemini-4-neon/i, name: "Neon", t: P_NEON },
  { re: /gemini-4-carbon/i, name: "Carbon", t: P_CARBON },
  { re: /gemini-4-argon/i, name: "Argon", t: P_CARBON },
  { re: /gemini-4-hydrogen-tiered/i, name: "Hydrogen", t: P_HYDROGEN },
  { re: /gemini-4-hydrogen/i, name: "Hydrogen", t: P_HYDROGEN },
  { re: /gemini-3[.-]8-flash/i, name: "3.8 Flash", t: P_FLASH_3X },
  { re: /gemini-3[.-]6-flash/i, name: "3.6 Flash", t: P_FLASH_3X },
  { re: /gemini-3[.-]5-flash-lite/i, name: "3.5 Flash-Lite", t: [[Infinity, { in: 0.3, cache: 0.03, out: 2.5 }]] },
  { re: /claude-opus-5[.-]5/i, name: "Opus 5.5", t: [[Infinity, { in: 4, cache: 0.2, cw: 5, out: 20 }]] },
  { re: /claude-opus-5(?![.-]?\d)/i, name: "Opus 5", t: [[Infinity, { in: 5, cache: 0.5, cw: 6.25, out: 25 }]] },
  { re: /claude-opus-4[.-][5678]/i, name: "Opus 4", t: [[Infinity, { in: 5, cache: 0.5, cw: 6.25, out: 25 }]] },
  { re: /claude-sonnet-5[.-]5/i, name: "Sonnet 5.5", t: [[Infinity, { in: 2, cache: 0.1, cw: 2.5, out: 10 }]] },
  { re: /claude-sonnet-5(?![.-]?\d)/i, name: "Sonnet 5", t: [[Infinity, { in: 2, cache: 0.2, cw: 2.5, out: 10 }]] },
  { re: /claude-sonnet-4[.-]6/i, name: "Sonnet 4.6", t: [[Infinity, { in: 3, cache: 0.3, cw: 3.75, out: 15 }]] },
  { re: /claude-haiku-4[.-]5/i, name: "Haiku 4.5", t: [[Infinity, { in: 1, cache: 0.1, cw: 1.25, out: 5 }]] },
];

export function priceFor(names, atMs = Date.now()) {
  const raw = String(names ?? "");
  if (!raw.trim()) return null;
  const normalized = raw.toLowerCase().replace(/[()]+/g, " ").replace(/[\s.]+/g, "-");
  const when = Number.isFinite(atMs) && atMs > 0 ? atMs : Date.now();
  for (const rule of PRICES) {
    if (!rule.re.test(raw) && !rule.re.test(normalized)) continue;
    const tier = rule.t.find((entry) => when < entry[0]) ?? rule.t.at(-1);
    return { name: rule.name, p: tier[1] };
  }
  return null;
}

export function callCost(usage, names, atMs = Date.now()) {
  if (!usage || typeof usage !== "object") return null;
  const inp = Number(usage.inp ?? usage.inputTokens) || 0;
  const cr = Number(usage.cr ?? usage.cacheReadTokens) || 0;
  const cw = Number(usage.cw ?? usage.cacheWriteTokens) || 0;
  const out = Math.max(
    Number(usage.out ?? usage.outputTokens) || 0,
    (Number(usage.thinkingOutputTokens) || 0) + (Number(usage.responseOutputTokens) || 0),
  );
  const price = priceFor(names, atMs);
  if (!price) return { usd: null, inp, cr, cw, out };
  const p = price.p;
  const parts = {
    in: inp * p.in / 1e6,
    cache: cr * p.cache / 1e6,
    cw: cw * (p.cw != null ? p.cw : p.in) / 1e6,
    out: out * p.out / 1e6,
  };
  return { usd: parts.in + parts.cache + parts.cw + parts.out, parts, price, inp, cr, cw, out };
}

// Generation time denominator (seconds), aligned with agy-zh-pack:
// - non-thinking call (think === 0): stream duration only (excludes prefill/queue TTFT)
// - thinking call with separable queue wait (0 < thinkDur < ttft): thinkDur + stream
// - otherwise (thinking spanned TTFT/stream, or think unknown): ttft + stream
export function callGenSpan(call) {
  if (!call || typeof call !== "object") return 0;
  const ttft = Number(call.ttft) || 0;
  const stream = Number(call.stream) || 0;
  const total = ttft + stream;
  if (call.think == null) return total;
  const think = Number(call.think) || 0;
  if (think === 0) return stream > 0 ? stream : total;
  const thinkDur = Number(call.thinkDur) || 0;
  if (thinkDur > 0 && thinkDur < ttft) return thinkDur + stream;
  return total;
}

export function callSpeed(call) {
  if (!call || typeof call !== "object") return null;
  const out = Number(call.out) || 0;
  const span = callGenSpan(call);
  return out >= SPEED_MIN_OUT && span >= SPEED_MIN_SEC ? out / span : null;
}

export function callSpeedLoose(call) {
  if (!call || typeof call !== "object") return null;
  const out = Number(call.out) || 0;
  const span = callGenSpan(call);
  return out > 0 && span > 0.05 ? out / span : null;
}

export function quantile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export function speedTier(tps) {
  const rate = Number(tps);
  if (!(rate > 0)) return "medium";
  if (rate < 30) return "slow";
  if (rate <= 60) return "medium";
  return "fast";
}

export function formatUsdToday(value) {
  const amount = Number(value) || 0;
  if (amount < 0.00005) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  if (amount < 99.995) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

export function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0.01) return "$0";
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount)}`;
}

// Fallback input prices (USD / 1M tokens) for older Claude model IDs not in PRICES,
// matching CCometixLine's built-in model table.
const CLAUDE_FAMILY_RE = /(?:(\d{1,2})(?:[.-](\d{1,2}))?-(opus|sonnet|haiku|fable|mythos)|(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:[.-](\d{1,2}))?)(?:-\d{3,}|-[a-z]|\[|@|:|$)/i;

function claudeFallbackInputPrice(names) {
  const match = CLAUDE_FAMILY_RE.exec(String(names ?? ""));
  if (!match) return null;
  const family = (match[3] || match[4] || "").toLowerCase();
  const major = Number(match[1] ?? match[5]);
  const minor = Number(match[2] ?? match[6] ?? 0);
  if (!Number.isFinite(major)) return null;
  if (family === "opus") return major > 4 || (major === 4 && minor >= 5) ? 5 : 15;
  if (family === "sonnet") return 3;
  if (family === "haiku") {
    if (major >= 4) return 1;
    if (major === 3 && minor >= 5) return 0.8;
    return 0.25;
  }
  if (family === "fable") return 10;
  return null;
}

export function estimateRewarmUsd(tokens, names, ttl = "5m", atMs = Date.now()) {
  const count = Number(tokens);
  if (!(count > 0) || !names) return null;
  const matched = priceFor(names, atMs);
  if (matched) {
    const p = matched.p;
    const rate = p.cw != null
      ? (ttl === "1h" ? p.in * 2 : p.cw)
      : p.in;
    return count * rate / 1e6;
  }
  const claudeIn = claudeFallbackInputPrice(names);
  if (claudeIn != null) {
    const mult = ttl === "1h" ? 2 : 1.25;
    return count * claudeIn * mult / 1e6;
  }
  return null;
}

export function pbGet(buf, field) {
  if (!Buffer.isBuffer(buf)) return undefined;
  let i = 0;
  const vi = () => {
    let x = 0;
    let m = 1;
    while (i < buf.length) {
      const c = buf[i++];
      x += (c & 0x7f) * m;
      m *= 128;
      if (!(c & 0x80)) break;
    }
    return x;
  };
  while (i < buf.length) {
    const key = vi();
    const k = Math.floor(key / 8);
    const wt = key % 8;
    if (k === 0) return undefined;
    let v;
    if (wt === 0) v = vi();
    else if (wt === 2) {
      const n = vi();
      if (n < 0 || i + n > buf.length) return undefined;
      v = buf.subarray(i, i + n);
      i += n;
    } else if (wt === 1) i += 8;
    else if (wt === 5) i += 4;
    else return undefined;
    if (k === field && v !== undefined) return v;
  }
  return undefined;
}

export function pbVarints(buf) {
  if (!Buffer.isBuffer(buf)) return [];
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let x = 0;
    let m = 1;
    while (i < buf.length) {
      const c = buf[i++];
      x += (c & 0x7f) * m;
      m *= 128;
      if (!(c & 0x80)) break;
    }
    out.push(x);
  }
  return out;
}

export function pbDur(buf) {
  return Buffer.isBuffer(buf) ? (pbGet(buf, 1) || 0) + (pbGet(buf, 2) || 0) / 1e9 : 0;
}

function readPlannerThinkDuration(stepPayload) {
  if (!stepPayload) return 0;
  const sp = Buffer.from(stepPayload);
  const pr = pbGet(sp, 20);
  if (!Buffer.isBuffer(pr)) return 0;
  const td = pbGet(pr, 11);
  if (!Buffer.isBuffer(td) || td.length === 0 || td.length > 16) return 0;
  const sec = pbDur(td);
  return Number.isFinite(sec) && sec > 0 && sec < 86_400 ? Math.round(sec * 1000) / 1000 : 0;
}

export function readConversationDb(DatabaseSync, file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const calls = [];
  try {
    const stepAt = new Map();
    const when = new Map();
    const hasStepPayload = db.prepare("pragma table_info(steps)").all().some((col) => col.name === "step_payload");
    const getStepPayload = hasStepPayload ? db.prepare("select step_payload from steps where idx = ?") : null;
    for (const row of db.prepare("select idx, metadata from steps").iterate()) {
      if (!row.metadata) continue;
      const m = Buffer.from(row.metadata);
      const ts = pbGet(m, 1);
      const sec = Buffer.isBuffer(ts) ? pbGet(ts, 1) : 0;
      if (!(sec > 0)) continue;
      stepAt.set(Number(row.idx), sec * 1000);
      const exec = pbGet(m, 12);
      if (Buffer.isBuffer(exec)) {
        const execId = exec.toString("utf8");
        if (!when.has(execId)) when.set(execId, sec * 1000);
      }
    }
    for (const row of db.prepare("select data from gen_metadata order by rowid").iterate()) {
      if (!row.data) continue;
      const g = Buffer.from(row.data);
      const exec = pbGet(g, 4);
      const cm = pbGet(g, 1);
      if (!Buffer.isBuffer(cm)) continue;
      const u = pbGet(cm, 4);
      if (!Buffer.isBuffer(u)) continue;
      const inp = pbGet(u, 2) || 0;
      const cw = pbGet(u, 4) || 0;
      const cr = pbGet(u, 5) || 0;
      const think = pbGet(u, 9) || 0;
      const out = Math.max(pbGet(u, 3) || 0, think + (pbGet(u, 10) || 0));
      if (!inp && !cr && !cw && !out) continue;
      const steps = pbGet(g, 2);
      let at = 0;
      let firstStepIdx = -1;
      const indices = Buffer.isBuffer(steps) ? pbVarints(steps) : typeof steps === "number" ? [steps] : [];
      for (const idx of indices) {
        if (firstStepIdx < 0) firstStepIdx = idx;
        at = stepAt.get(idx) || 0;
        if (at) break;
      }
      if (!at && Buffer.isBuffer(exec)) at = when.get(exec.toString("utf8")) || 0;
      if (!(at > 0)) continue;
      const str = (b, limit) => (Buffer.isBuffer(b) ? b.toString("utf8").slice(0, limit) : "");
      const ttft = Math.round(pbDur(pbGet(cm, 11)) * 1000) / 1000;
      const stream = Math.round(pbDur(pbGet(cm, 12)) * 1000) / 1000;
      let thinkDur = 0;
      if (think > 0 && getStepPayload && firstStepIdx >= 0) {
        const stepRow = getStepPayload.get(firstStepIdx);
        if (stepRow?.step_payload) thinkDur = readPlannerThinkDuration(stepRow.step_payload);
      }
      calls.push([
        at,
        str(pbGet(cm, 19), 60) || "unknown",
        inp,
        cr,
        cw,
        out,
        ttft,
        stream,
        str(pbGet(cm, 21), 60),
        str(pbGet(u, 11), 80),
        think,
        thinkDur,
      ]);
    }
  } finally {
    db.close();
  }
  return calls;
}

export function callKey(convId, tuple) {
  return tuple[9] || `${convId}:${tuple[0]}:${tuple[2]}:${tuple[5]}`;
}

function tupleToCall(tuple) {
  return {
    at: tuple[0],
    model: tuple[1],
    inp: tuple[2],
    cr: tuple[3],
    cw: tuple[4],
    out: tuple[5],
    ttft: tuple[6],
    stream: tuple[7],
    disp: tuple[8] || "",
    rid: tuple[9] || "",
    ...(tuple.length > 10 ? { think: tuple[10], thinkDur: tuple[11] || 0 } : {}),
  };
}

export function summarizeConversationTps(tuples) {
  if (!Array.isArray(tuples) || tuples.length === 0) return null;
  const seen = new Set();
  const calls = [];
  for (const tuple of tuples) {
    const key = tuple[9];
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    calls.push(tupleToCall(tuple));
  }
  const modelKeyOf = (call) => call.disp || call.model || "";
  const speedsByModel = new Map();
  let latestQualifying = null;
  let latestLoose = null;
  for (const call of calls) {
    const qualified = callSpeed(call);
    if (qualified != null) {
      const key = modelKeyOf(call);
      const bucket = speedsByModel.get(key) ?? [];
      bucket.push(qualified);
      speedsByModel.set(key, bucket);
      latestQualifying = { call, rate: qualified };
    } else {
      const loose = callSpeedLoose(call);
      if (loose != null) latestLoose = { call, rate: loose };
    }
  }
  const picked = latestQualifying ?? latestLoose;
  if (!picked) return null;
  const modelKey = modelKeyOf(picked.call);
  const modelSpeeds = (speedsByModel.get(modelKey) ?? []).slice().sort((a, b) => a - b);
  const median = modelSpeeds.length >= SPEED_MIN_SAMPLES ? quantile(modelSpeeds, 0.5) : null;
  const total = picked.call.ttft + picked.call.stream;
  const span = callGenSpan(picked.call);
  return {
    rate: picked.rate,
    tps: Math.round(picked.rate),
    ttft: picked.call.ttft,
    stream: picked.call.stream,
    span,
    total,
    output_tokens: picked.call.out,
    median: median != null ? Math.round(median) : null,
    samples: modelSpeeds.length,
    tier: speedTier(picked.rate),
    model: modelKey,
  };
}

export function sumConversationCost(tuples) {
  if (!Array.isArray(tuples) || tuples.length === 0) return null;
  let total = 0;
  let priced = 0;
  const seen = new Set();
  for (const tuple of tuples) {
    const key = tuple[9];
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const call = tupleToCall(tuple);
    const result = callCost(call, `${call.model} ${call.disp}`, call.at);
    if (result?.usd != null) {
      total += result.usd;
      priced += 1;
    }
  }
  return priced > 0 ? total : null;
}

export function summarizeConversationCache(tuples, nowMs = Date.now()) {
  if (!Array.isArray(tuples) || tuples.length === 0) return null;
  const seen = new Set();
  const calls = [];
  for (const tuple of tuples) {
    const key = tuple[9];
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    calls.push(tupleToCall(tuple));
  }
  if (calls.length === 0) return null;

  let cachingObserved = false;
  let totalInp = 0;
  let totalCr = 0;
  let totalCw = 0;
  for (const call of calls) {
    if (call.cr > 0 || call.cw > 0) cachingObserved = true;
    totalInp += call.inp;
    totalCr += call.cr;
    totalCw += call.cw;
  }
  if (!cachingObserved) return null;

  const totalPrompt = totalInp + totalCr + totalCw;
  const hitRatio = totalPrompt > 0 ? totalCr / totalPrompt : 0;

  const ttl = "5m";
  const ttlSec = CACHE_TTL_5M;
  const last = calls.at(-1);
  const lastEndMs = Math.min(nowMs, last.at + Math.round(((last.ttft || 0) + (last.stream || 0)) * 1000));
  const expiresAt = Math.floor(lastEndMs / 1000) + ttlSec;
  const warm = expiresAt > Math.floor(nowMs / 1000);

  // Detect cache misses across the conversation (adapted from agy-zh-pack).
  const lastBigByModel = new Map();
  let lastBigAny = -1;
  let misses = 0;
  let lastMissAt = null;
  let lastMissCause = null;

  calls.forEach((call, index) => {
    const names = `${call.model} ${call.disp}`.trim();
    const matched = priceFor(names, call.at);
    const modelKey = matched ? matched.name : call.model;
    const prompt = call.inp + call.cr + call.cw;
    let prevIndex = lastBigByModel.has(modelKey) ? lastBigByModel.get(modelKey) : -1;
    let cause = "";
    if (prevIndex < 0 && lastBigAny >= 0) {
      prevIndex = lastBigAny;
      cause = "model_switch";
    }
    if (prevIndex >= 0) {
      const prev = calls[prevIndex];
      const prevPrompt = prev.inp + prev.cr + prev.cw;
      const missedTokens = Math.max(0, Math.min(prevPrompt, prompt) - call.cr);
      if (missedTokens >= CACHE_MISS_MIN_TOKENS) {
        const idleMs = Math.max(0, call.at - prev.at - ((prev.ttft || 0) + (prev.stream || 0)) * 1000);
        if (!cause) {
          if (prompt < 0.6 * prevPrompt) cause = "compaction";
          else if (idleMs >= ttlSec * 1000) cause = "ttl_expired_5m";
          else if (idleMs >= CACHE_MISS_IDLE_MS) cause = "idle_pause";
          else cause = "other";
        }
        misses += 1;
        lastMissAt = Math.floor(call.at / 1000);
        lastMissCause = cause;
      }
    }
    if (prompt >= CACHE_MISS_MIN_TOKENS) {
      lastBigByModel.set(modelKey, index);
      lastBigAny = index;
    }
  });

  const lastPrompt = last.inp + last.cr + last.cw;
  const lastNames = `${last.model} ${last.disp}`.trim();
  const rewarmUsd = lastPrompt > 0 ? estimateRewarmUsd(lastPrompt, lastNames, ttl, last.at) : null;

  return {
    warm,
    caching_observed: true,
    ttl,
    expires_at: expiresAt,
    requests: calls.length,
    misses,
    hit_ratio: hitRatio,
    last_miss_at: lastMissAt,
    last_miss_cause: lastMissCause ? { causes: [lastMissCause] } : null,
    recache_tokens_if_cold: lastPrompt > 0 ? lastPrompt : null,
    rewarm_usd: rewarmUsd,
    last_read: last.cr,
    last_created: last.cw,
    model: lastNames,
  };
}

function localDayStart(nowMs) {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localDayName(nowMs) {
  const date = new Date(nowMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dbMtime(file) {
  let mt = 0;
  try { mt = statSync(file).mtimeMs; } catch { return 0; }
  try { mt = Math.max(mt, statSync(`${file}-wal`).mtimeMs); } catch { /* WAL may not exist. */ }
  return mt;
}

function readCache(file, day) {
  if (!file) return { version: CACHE_VERSION, day, files: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && parsed.version === CACHE_VERSION && parsed.day === day && parsed.files && typeof parsed.files === "object") {
      return parsed;
    }
  } catch { /* Missing or corrupt cache is rebuilt cleanly. */ }
  return { version: CACHE_VERSION, day, files: {} };
}

function writeCache(file, cache) {
  if (!file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    renameSync(tmp, file);
  } catch { /* Best-effort cache; never break status-line rendering. */ }
}

function defaultConvDirs(root, env = process.env, home = os.homedir()) {
  const dirs = [path.join(root, "conversations")];
  if (!env[ENV_HOME]) {
    const desktop = path.join(home, ".gemini", "antigravity", "conversations");
    if (desktop !== dirs[0]) dirs.push(desktop);
  }
  return dirs;
}

let sqliteLoader;
async function loadSqlite() {
  if (sqliteLoader === undefined) {
    sqliteLoader = import("node:sqlite").then((mod) => mod.DatabaseSync).catch(() => null);
  }
  return sqliteLoader;
}

function pbTimestampMs(buf) {
  if (!Buffer.isBuffer(buf)) return 0;
  const sec = pbGet(buf, 1) || 0;
  const nanos = pbGet(buf, 2) || 0;
  if (!(sec > 946_684_800)) return 0; // Ignore unset/epoch-zero timestamps (< 2000-01-01)
  return sec * 1000 + Math.round(nanos / 1e6);
}

function parseSqlTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 946_684_800_000 ? value : value > 946_684_800 ? value * 1000 : 0;
  }
  const text = String(value ?? "").trim();
  if (!text || text.startsWith("0001-")) return 0;
  const normalized = text.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed > 946_684_800_000 ? parsed : 0;
}

export function normalizeSubagentStatus(rawStatus, killed = 0) {
  if (killed) return "killed";
  const text = String(rawStatus ?? "").trim().toUpperCase();
  if (!text) return "done";
  if (/(WAIT|CONFIRM|APPROVAL|PERMISSION)/.test(text)) return "waiting";
  if (/(RUNNING|BUSY|CANCELING|GENERATING|PENDING|ACTIVE|WORKING)/.test(text)) return "running";
  if (/(ERROR|FAIL)/.test(text)) return "error";
  if (/(KILL|STOP|ABORT|CANCEL)/.test(text)) return "killed";
  return "done";
}

function normalizeModelFamily(names) {
  const raw = String(names ?? "").trim();
  if (!raw) return "";
  const priced = priceFor(raw);
  if (priced) return priced.name.toLowerCase();
  return raw.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/[\s._]+/g, "-");
}

function modelsShareWindow(subNames, mainNames) {
  const subFam = normalizeModelFamily(subNames);
  const mainFam = normalizeModelFamily(mainNames);
  return Boolean(subFam && mainFam && subFam === mainFam);
}

function cleanSubagentModelName(disp, model) {
  const candidate = String(disp || model || "").trim();
  if (!candidate || candidate === "unknown" || /(?:PLACEHOLDER|MODEL_)/i.test(candidate)) return null;
  return candidate;
}

function readInvokeSubagentSteps(DatabaseSync, file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const cols = db.prepare("pragma table_info(steps)").all().map((c) => c.name);
    if (!cols.includes("metadata")) return [];
    const hasPayload = cols.includes("step_payload");
    const query = hasPayload
      ? "select metadata, step_payload from steps order by idx"
      : "select metadata from steps order by idx";
    const invokes = [];
    for (const row of db.prepare(query).iterate()) {
      if (!row.metadata) continue;
      const m = Buffer.from(row.metadata);
      const tc = pbGet(m, 4);
      if (!Buffer.isBuffer(tc)) continue;
      const toolNameBuf = pbGet(tc, 2);
      if (!Buffer.isBuffer(toolNameBuf) || toolNameBuf.toString("utf8") !== "invoke_subagent") continue;
      const argsBuf = pbGet(tc, 3);
      let args = {};
      if (Buffer.isBuffer(argsBuf)) {
        try { args = JSON.parse(argsBuf.toString("utf8")) || {}; } catch { args = {}; }
      }
      let childId = "";
      if (hasPayload && row.step_payload) {
        const sp = Buffer.from(row.step_payload);
        const generic = pbGet(sp, 140);
        const result = Buffer.isBuffer(generic) ? pbGet(generic, 2) : null;
        const textBuf = Buffer.isBuffer(result) ? pbGet(result, 1) : null;
        const text = Buffer.isBuffer(textBuf) ? textBuf.toString("utf8") : "";
        const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
        if (match) childId = match[1];
      }
      const at = pbTimestampMs(pbGet(m, 1));
      const typeName = String(args.TypeName || args.typeName || args.type_name || "").trim();
      const role = String(args.Role || args.role || "").trim();
      const model = String(args.Model || args.model || "").trim();
      if (childId || typeName || role) {
        invokes.push({ id: childId, typeName, role, model, at });
      }
    }
    return invokes;
  } catch {
    return [];
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

function readSubagentStepCount(DatabaseSync, file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare("select count(*) as cnt from steps").get();
    const first = db.prepare("select metadata from steps order by idx limit 1").get();
    const createdAt = first?.metadata ? pbTimestampMs(pbGet(Buffer.from(first.metadata), 1)) : 0;
    return { steps: Number(row?.cnt) || 0, createdAt };
  } catch {
    return { steps: 0, createdAt: 0 };
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

export function readSubagentsFromSummaryDb(DatabaseSync, summaryFile, rootConvId) {
  if (!summaryFile || !rootConvId) return [];
  let db;
  try {
    db = new DatabaseSync(summaryFile, { readOnly: true });
    const tables = new Set(
      db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name),
    );
    if (!tables.has("conversation_summaries")) return [];

    const parentOf = new Map();
    if (tables.has("conversation_parents")) {
      for (const row of db.prepare("select conversation_id, parent_id from conversation_parents").iterate()) {
        if (row.conversation_id && row.parent_id && row.conversation_id !== row.parent_id) {
          parentOf.set(String(row.conversation_id), String(row.parent_id));
        }
      }
    }

    const cols = new Set(db.prepare("pragma table_info(conversation_summaries)").all().map((col) => col.name));
    const selectCols = [
      "conversation_id",
      cols.has("title") ? "title" : "'' as title",
      cols.has("step_count") ? "step_count" : "0 as step_count",
      cols.has("last_modified_time") ? "last_modified_time" : "'' as last_modified_time",
      cols.has("status") ? "status" : "'' as status",
      cols.has("agent_name") ? "agent_name" : "'' as agent_name",
      cols.has("parent_conversation_id") ? "parent_conversation_id" : "'' as parent_conversation_id",
      cols.has("nesting_depth") ? "nesting_depth" : "0 as nesting_depth",
      cols.has("killed") ? "killed" : "0 as killed",
      cols.has("raw_summary") ? "raw_summary" : "null as raw_summary",
    ];

    const candidates = new Map();
    const rootOf = new Map();
    const rows = db.prepare(`select ${selectCols.join(", ")} from conversation_summaries`).all();
    for (const row of rows) {
      const id = String(row.conversation_id || "").trim();
      if (!id) continue;
      const parent = String(row.parent_conversation_id || "").trim();
      if (parent && parent !== id) parentOf.set(id, parent);

      let createdAt = 0;
      let rawModifiedAt = 0;
      if (row.raw_summary) {
        const raw = Buffer.from(row.raw_summary);
        createdAt = pbTimestampMs(pbGet(raw, 7));
        rawModifiedAt = pbTimestampMs(pbGet(raw, 3));
        const tm = pbGet(raw, 17);
        if (Buffer.isBuffer(tm)) {
          if (!createdAt) createdAt = pbTimestampMs(pbGet(tm, 2));
          const rootBuf = pbGet(tm, 6);
          if (Buffer.isBuffer(rootBuf)) {
            const rootId = rootBuf.toString("utf8").trim();
            if (rootId && rootId !== id) rootOf.set(id, rootId);
          }
        }
      }

      if (parent || parentOf.has(id) || Number(row.nesting_depth) > 0 || rootOf.has(id)) {
        candidates.set(id, {
          id,
          parent: parent || parentOf.get(id) || "",
          agentName: String(row.agent_name || "").trim(),
          title: String(row.title || "").trim(),
          status: normalizeSubagentStatus(row.status, Number(row.killed) || 0),
          steps: Number(row.step_count) || 0,
          createdAt,
          modifiedAt: rawModifiedAt || parseSqlTimeMs(row.last_modified_time),
        });
      }
    }

    const belongsToRoot = (id) => {
      if (id === rootConvId) return false;
      if (rootOf.get(id) === rootConvId) return true;
      let cursor = id;
      const visited = new Set();
      for (let hop = 0; hop < 10 && cursor; hop += 1) {
        if (visited.has(cursor)) break;
        visited.add(cursor);
        const next = parentOf.get(cursor);
        if (!next) break;
        if (next === rootConvId) return true;
        cursor = next;
      }
      return false;
    };

    const descendants = [];
    for (const entry of candidates.values()) {
      if (belongsToRoot(entry.id)) descendants.push(entry);
    }
    return descendants;
  } catch {
    return [];
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

export async function readTelemetry({
  conversationId = "",
  needTps = false,
  needTodayCost = false,
  needSessionCost = false,
  needCache = false,
  needSubagents = false,
  contextWindowSize = 0,
  mainModel = "",
  root = configRoot(),
  convDirs,
  summaryDbPath,
  cacheFile,
  now = Date.now(),
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (!needTps && !needTodayCost && !needSessionCost && !needCache && !needSubagents) return null;
  const DatabaseSync = await loadSqlite();
  if (!DatabaseSync) return null;

  const dirs = convDirs ?? defaultConvDirs(root, env, home);
  const resolvedCacheFile = cacheFile === undefined ? path.join(runtimeDir(root), "telemetry-cache.json") : cacheFile;
  const resolvedSummaryDb = summaryDbPath === undefined ? path.join(root, "conversation_summaries.db") : summaryDbPath;
  const day = localDayName(now);
  const dayStart = localDayStart(now);
  const cache = readCache(resolvedCacheFile, day);
  let cacheDirty = false;

  const loadDb = (file) => {
    const mt = dbMtime(file);
    if (!mt) return null;
    const cached = cache.files[file];
    if (cached && cached.mtime === mt && Array.isArray(cached.calls)) return cached.calls;
    try {
      const calls = readConversationDb(DatabaseSync, file);
      cache.files[file] = { mtime: mt, calls };
      cacheDirty = true;
      return calls;
    } catch {
      return cached && Array.isArray(cached.calls) ? cached.calls : null;
    }
  };

  const findConvFile = (id) => {
    for (const dir of dirs) {
      const file = path.join(dir, `${id}.db`);
      if (dbMtime(file)) return file;
    }
    return null;
  };

  let tps = null;
  let sessionCostUsd = null;
  let promptCache = null;
  let subagents = null;
  const validConv = typeof conversationId === "string" && UUID_RE.test(conversationId.trim())
    ? conversationId.trim()
    : "";

  if (validConv && (needTps || needSessionCost || needCache)) {
    const file = findConvFile(validConv);
    const calls = file ? loadDb(file) : null;
    if (calls) {
      if (needTps) tps = summarizeConversationTps(calls);
      if (needSessionCost) sessionCostUsd = sumConversationCost(calls);
      if (needCache) promptCache = summarizeConversationCache(calls, now);
    }
  }

  if (validConv && needSubagents) {
    const summaryEntries = readSubagentsFromSummaryDb(DatabaseSync, resolvedSummaryDb, validConv);
    const parentFile = findConvFile(validConv);
    const parentInvokes = parentFile ? readInvokeSubagentSteps(DatabaseSync, parentFile) : [];
    const invokeById = new Map();
    for (const inv of parentInvokes) {
      if (inv.id) invokeById.set(inv.id, inv);
    }

    const byId = new Map();
    for (const entry of summaryEntries) {
      const inv = invokeById.get(entry.id);
      byId.set(entry.id, {
        ...entry,
        typeName: inv?.typeName || entry.agentName || "",
        role: inv?.role || entry.title || "",
        invokeModel: inv?.model || "",
        createdAt: entry.createdAt || inv?.at || 0,
      });
    }
    for (const inv of parentInvokes) {
      if (!inv.id || byId.has(inv.id)) continue;
      const subFile = findConvFile(inv.id);
      const mt = subFile ? dbMtime(subFile) : 0;
      if (!mt) continue;
      byId.set(inv.id, {
        id: inv.id,
        parent: validConv,
        agentName: inv.typeName,
        title: inv.role,
        typeName: inv.typeName,
        role: inv.role,
        invokeModel: inv.model,
        status: now - mt < SUBAGENT_DONE_SHOW_MS ? "running" : "done",
        steps: 0,
        createdAt: inv.at || 0,
        modifiedAt: mt,
      });
    }

    const list = [];
    for (const entry of byId.values()) {
      const active = entry.status === "running" || entry.status === "waiting";
      // Skip opening old historical subagent DBs that finished well past DONE_SHOW_MS
      const staleDone = !active && entry.modifiedAt > 0 && now - entry.modifiedAt >= SUBAGENT_DONE_SHOW_MS + 60_000;
      let model = null;
      let promptTokens = null;
      let contextPct = null;
      let cacheHit = null;
      let costUsd = null;
      let startedAt = entry.createdAt || 0;
      let endedAt = !active ? (entry.modifiedAt || 0) : 0;
      let steps = entry.steps || 0;

      if (!staleDone) {
        const subFile = findConvFile(entry.id);
        if (subFile) {
          const calls = loadDb(subFile);
          if (calls && calls.length > 0) {
            const last = tupleToCall(calls.at(-1));
            const names = `${last.model} ${last.disp}`.trim();
            model = cleanSubagentModelName(last.disp, last.model);
            const prompt = last.inp + last.cr + last.cw;
            if (prompt > 0) {
              promptTokens = prompt;
              if (contextWindowSize > 0 && modelsShareWindow(names, mainModel)) {
                contextPct = Math.max(0, Math.min(100, Math.round((prompt / contextWindowSize) * 100)));
              }
            }
            if (last.cr > 0 && prompt > 0) {
              const pct = Math.round((last.cr / prompt) * 100);
              cacheHit = pct === 0 ? 1 : pct;
            }
            const ownCost = sumConversationCost(calls);
            if (ownCost != null && ownCost > 0) costUsd = ownCost;
            const firstAt = calls[0][0] || 0;
            if (!startedAt || (firstAt > 0 && firstAt < startedAt)) startedAt = firstAt;
            const lastEnd = last.at + Math.round(((last.ttft || 0) + (last.stream || 0)) * 1000);
            if (!active && lastEnd > endedAt) endedAt = lastEnd;
          }
          if (!steps || !startedAt) {
            const info = readSubagentStepCount(DatabaseSync, subFile);
            if (!steps && info.steps > 0) steps = info.steps;
            if (!startedAt && info.createdAt > 0) startedAt = info.createdAt;
          }
        }
      }

      if (!model && entry.invokeModel && !/^(?:inherit|default)$/i.test(entry.invokeModel)) {
        model = cleanSubagentModelName("", entry.invokeModel);
      }

      const durationMs = active
        ? (startedAt > 0 && now >= startedAt ? now - startedAt : null)
        : (startedAt > 0 && endedAt > startedAt ? endedAt - startedAt : null);

      list.push({
        id: entry.id,
        typeName: entry.typeName || entry.agentName || "subagent",
        role: entry.role || entry.title || null,
        model,
        contextPct,
        contextTokens: promptTokens,
        cacheHit,
        costUsd,
        status: entry.status,
        steps: steps > 0 ? steps : null,
        startedAt: startedAt || null,
        endedAt: endedAt || null,
        durationMs,
        lastAt: endedAt || entry.modifiedAt || startedAt || 0,
      });
    }

    if (list.length > 0) subagents = list;
  }

  let todayCost = null;
  if (needTodayCost) {
    const seen = new Set();
    const convs = new Set();
    let totalUsd = 0;
    let callCount = 0;
    const present = new Set();

    for (const dir of dirs) {
      let names;
      try {
        names = readdirSync(dir).filter((name) => DB_FILE_RE.test(name));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(dir, name);
        const mt = dbMtime(file);
        if (mt < dayStart) continue;
        present.add(file);
        const calls = loadDb(file);
        if (!calls) continue;
        const convId = name.slice(0, -3);
        for (const tuple of calls) {
          if (tuple[0] < dayStart || tuple[0] > now + 60_000) continue;
          const key = callKey(convId, tuple);
          if (seen.has(key)) continue;
          seen.add(key);
          callCount += 1;
          convs.add(convId);
          const call = tupleToCall(tuple);
          const cost = callCost(call, `${call.model} ${call.disp}`, call.at);
          if (cost?.usd != null) totalUsd += cost.usd;
        }
      }
    }

    for (const cachedFile of Object.keys(cache.files)) {
      if (!present.has(cachedFile) && (!validConv || !cachedFile.endsWith(`${path.sep}${validConv}.db`))) {
        delete cache.files[cachedFile];
        cacheDirty = true;
      }
    }

    if (callCount > 0) {
      todayCost = {
        total_usd: totalUsd,
        calls: callCount,
        conversations: convs.size,
      };
    }
  }

  if (cacheDirty) writeCache(resolvedCacheFile, cache);

  return { tps, todayCost, sessionCostUsd, cache: promptCache, subagents };
}
