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
const CACHE_VERSION = 1;

export const SPEED_MIN_OUT = 100;
export const SPEED_MIN_SEC = 0.3;

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

export function callSpeed(call) {
  if (!call || typeof call !== "object") return null;
  const out = Number(call.out) || 0;
  const total = (Number(call.ttft) || 0) + (Number(call.stream) || 0);
  return out >= SPEED_MIN_OUT && total >= SPEED_MIN_SEC ? out / total : null;
}

export function callSpeedLoose(call) {
  if (!call || typeof call !== "object") return null;
  const out = Number(call.out) || 0;
  const total = (Number(call.ttft) || 0) + (Number(call.stream) || 0);
  return out > 0 && total > 0.05 ? out / total : null;
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

export function readConversationDb(DatabaseSync, file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const calls = [];
  try {
    const stepAt = new Map();
    const when = new Map();
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
      const out = Math.max(pbGet(u, 3) || 0, (pbGet(u, 9) || 0) + (pbGet(u, 10) || 0));
      if (!inp && !cr && !cw && !out) continue;
      const steps = pbGet(g, 2);
      let at = 0;
      const indices = Buffer.isBuffer(steps) ? pbVarints(steps) : typeof steps === "number" ? [steps] : [];
      for (const idx of indices) {
        at = stepAt.get(idx) || 0;
        if (at) break;
      }
      if (!at && Buffer.isBuffer(exec)) at = when.get(exec.toString("utf8")) || 0;
      if (!(at > 0)) continue;
      const str = (b, limit) => (Buffer.isBuffer(b) ? b.toString("utf8").slice(0, limit) : "");
      const ttft = Math.round(pbDur(pbGet(cm, 11)) * 1000) / 1000;
      const stream = Math.round(pbDur(pbGet(cm, 12)) * 1000) / 1000;
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
  };
}

export function summarizeConversationTps(tuples) {
  if (!Array.isArray(tuples) || tuples.length === 0) return null;
  const calls = tuples.map(tupleToCall);
  const speeds = [];
  let latestQualifying = null;
  let latestLoose = null;
  for (const call of calls) {
    const qualified = callSpeed(call);
    if (qualified != null) {
      speeds.push(qualified);
      latestQualifying = { call, rate: qualified };
    } else {
      const loose = callSpeedLoose(call);
      if (loose != null) latestLoose = { call, rate: loose };
    }
  }
  const picked = latestQualifying ?? latestLoose;
  if (!picked) return null;
  speeds.sort((a, b) => a - b);
  const median = quantile(speeds, 0.5);
  const total = picked.call.ttft + picked.call.stream;
  return {
    rate: picked.rate,
    tps: Math.round(picked.rate),
    ttft: picked.call.ttft,
    stream: picked.call.stream,
    total,
    output_tokens: picked.call.out,
    median: median != null ? Math.round(median) : null,
    samples: speeds.length,
    tier: speedTier(picked.rate),
    model: picked.call.disp || picked.call.model,
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

export async function readTelemetry({
  conversationId = "",
  needTps = false,
  needTodayCost = false,
  needSessionCost = false,
  root = configRoot(),
  convDirs,
  cacheFile,
  now = Date.now(),
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (!needTps && !needTodayCost && !needSessionCost) return null;
  const DatabaseSync = await loadSqlite();
  if (!DatabaseSync) return null;

  const dirs = convDirs ?? defaultConvDirs(root, env, home);
  const resolvedCacheFile = cacheFile === undefined ? path.join(runtimeDir(root), "telemetry-cache.json") : cacheFile;
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

  let tps = null;
  let sessionCostUsd = null;
  const validConv = typeof conversationId === "string" && UUID_RE.test(conversationId.trim())
    ? conversationId.trim()
    : "";

  if (validConv && (needTps || needSessionCost)) {
    for (const dir of dirs) {
      const file = path.join(dir, `${validConv}.db`);
      const calls = loadDb(file);
      if (calls) {
        if (needTps) tps = summarizeConversationTps(calls);
        if (needSessionCost) sessionCostUsd = sumConversationCost(calls);
        break;
      }
    }
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

  return { tps, todayCost, sessionCostUsd };
}
