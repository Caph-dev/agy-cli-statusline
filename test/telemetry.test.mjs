import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { stripAnsi } from '../lib/ansi.mjs';
import { normalizePreferences } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { collectSegments } from '../lib/segments.mjs';
import {
  callCost,
  callGenSpan,
  callSpeed,
  estimateRewarmUsd,
  formatMoney,
  formatUsdToday,
  pbDur,
  pbGet,
  pbVarints,
  priceFor,
  quantile,
  readConversationDb,
  readTelemetry,
  SPEED_MIN_SAMPLES,
  speedTier,
  summarizeConversationCache,
  summarizeConversationTps,
} from '../lib/telemetry.mjs';

// Minimal protobuf encoders matching agy conversation SQLite blobs
const varint = (n) => {
  const bytes = [];
  let value = n;
  do {
    let chunk = value % 128;
    value = Math.floor(value / 128);
    if (value) chunk |= 0x80;
    bytes.push(chunk);
  } while (value);
  return Buffer.from(bytes);
};
const fv = (f, n) => Buffer.concat([varint(f * 8), varint(n)]);
const fb = (f, v) => {
  const buf = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
  return Buffer.concat([varint(f * 8 + 2), varint(buf.length), buf]);
};
const packed = (f, list) => fb(f, Buffer.concat(list.map(varint)));
const dur = (sec) => Buffer.concat([fv(1, Math.floor(sec)), fv(2, Math.round((sec % 1) * 1e9))]);
const usageBlob = ({ inp = 0, out = 0, cw = 0, cr = 0, think = 0, vis = 0, rid = '' }) => Buffer.concat([
  fv(2, inp),
  fv(3, out),
  fv(4, cw),
  fv(5, cr),
  fv(9, think),
  fv(10, vis),
  ...(rid ? [fb(11, rid)] : []),
]);

function writeConvDb(file, { steps, gens, withStepPayload = false }) {
  const db = new DatabaseSync(file);
  if (withStepPayload) {
    db.exec('create table steps (idx integer, metadata blob, step_payload blob); create table gen_metadata (data blob);');
    const insStep = db.prepare('insert into steps values (?, ?, ?)');
    for (const { idx, sec, exec = '', thinkDur = 0 } of steps) {
      const meta = Buffer.concat([fb(1, fv(1, sec)), ...(exec ? [fb(12, exec)] : [])]);
      const payload = thinkDur > 0 ? fb(20, fb(11, dur(thinkDur))) : null;
      insStep.run(idx, meta, payload);
    }
  } else {
    db.exec('create table steps (idx integer, metadata blob); create table gen_metadata (data blob);');
    const insStep = db.prepare('insert into steps values (?, ?)');
    for (const { idx, sec, exec = '' } of steps) {
      insStep.run(idx, Buffer.concat([fb(1, fv(1, sec)), ...(exec ? [fb(12, exec)] : [])]));
    }
  }
  const insGen = db.prepare('insert into gen_metadata values (?)');
  for (const g of gens) {
    const cm = Buffer.concat([
      fb(4, usageBlob(g.usage)),
      ...(g.ttft ? [fb(11, dur(g.ttft))] : []),
      ...(g.stream ? [fb(12, dur(g.stream))] : []),
      ...(g.model ? [fb(19, g.model)] : []),
      ...(g.disp ? [fb(21, g.disp)] : []),
    ]);
    insGen.run(Buffer.concat([
      fb(1, cm),
      ...(g.steps ? [packed(2, g.steps)] : []),
      ...(g.exec ? [fb(4, g.exec)] : []),
    ]));
  }
  db.close();
}

test('protobuf helpers decode varints, length-delimited fields, packed arrays, and durations', () => {
  const msg = Buffer.concat([fv(1, 300), fb(2, 'abc'), packed(3, [1, 200, 70000]), fb(4, dur(2.25))]);
  assert.equal(pbGet(msg, 1), 300);
  assert.equal(pbGet(msg, 2).toString('utf8'), 'abc');
  assert.deepEqual(pbVarints(pbGet(msg, 3)), [1, 200, 70000]);
  assert.equal(pbDur(pbGet(msg, 4)), 2.25);
  assert.equal(pbGet(msg, 9), undefined);
});

test('pricing table handles Gemini/Claude models, orchestrator aliases, cache writes, and Pacific midnight price cuts', () => {
  const beforeDec = Date.parse('2026-11-30T23:00:00Z');
  const afterDec = Date.parse('2026-12-01T08:00:00Z');

  // Carbon doubles at 2026-12-01T08:00:00Z (Pacific midnight)
  assert.deepEqual(priceFor('gemini-4-carbon', beforeDec).p, { in: 2, cache: 0.1, out: 10 });
  assert.deepEqual(priceFor('gemini-4-carbon', afterDec).p, { in: 4, cache: 0.2, out: 20 });
  assert.deepEqual(priceFor('orchestrator-neon', afterDec).p, { in: 3, cache: 0.15, out: 15 });
  assert.deepEqual(priceFor('gemini-flash-worker-agy', afterDec).p, { in: 1.5, cache: 0.075, out: 7.5 });
  assert.deepEqual(priceFor('Gemini 4 Neon (XHigh)', afterDec).p, { in: 3, cache: 0.15, out: 15 });

  // Claude Opus 5.5 includes 5m cache write pricing ($5/M)
  const opus = callCost({ inp: 100_000, cr: 500_000, cw: 200_000, out: 50_000 }, 'claude-opus-5-5', beforeDec);
  // 0.40 + 0.10 + 1.00 + 1.00 = 2.50
  assert.equal(Number(opus.usd.toFixed(6)), 2.5);

  // Unknown model returns null usd cleanly
  assert.equal(callCost({ inp: 1000, out: 100 }, 'gpt-oss-120b', beforeDec).usd, null);

  // USD formatting matches agy-zh-pack rules
  assert.equal(formatUsdToday(0), '$0.00');
  assert.equal(formatUsdToday(0.004), '<$0.01');
  assert.equal(formatUsdToday(8.423), '$8.42');
  assert.equal(formatUsdToday(125.4), '$125');
});

test('TPS calculation uses smart generation span, deduplicates rid, and computes per-model median with min samples', () => {
  // Unknown think -> ttft + stream
  assert.equal(callGenSpan({ ttft: 4, stream: 6 }), 10);
  assert.equal(callSpeed({ out: 1000, ttft: 4, stream: 6 }), 100);
  assert.equal(callSpeed({ out: 99, ttft: 1, stream: 1 }), null);
  assert.equal(callSpeed({ out: 500, ttft: 0.1, stream: 0.1 }), null);

  // Non-thinking call (think === 0) excludes TTFT queue/prefill and uses stream duration
  assert.equal(callGenSpan({ ttft: 5, stream: 2, think: 0 }), 2);
  assert.equal(callSpeed({ out: 200, ttft: 5, stream: 2, think: 0 }), 100);
  // Missing stream (0) falls back to ttft + stream
  assert.equal(callGenSpan({ ttft: 4, stream: 0, think: 0 }), 4);

  // Thinking call with separable queue wait (0 < thinkDur < ttft) uses thinkDur + stream
  assert.equal(callGenSpan({ ttft: 10, stream: 2, think: 300, thinkDur: 3 }), 5);
  assert.equal(callSpeed({ out: 500, ttft: 10, stream: 2, think: 300, thinkDur: 3 }), 100);
  // Thinking call where thinkDur >= ttft or absent falls back to ttft + stream
  assert.equal(callGenSpan({ ttft: 10, stream: 2, think: 300, thinkDur: 12 }), 12);
  assert.equal(callGenSpan({ ttft: 10, stream: 2, think: 300, thinkDur: 0 }), 12);

  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10, 20, 30, 40], 0.5), 25);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);

  assert.equal(speedTier(29), 'slow');
  assert.equal(speedTier(30), 'medium');
  assert.equal(speedTier(60), 'medium');
  assert.equal(speedTier(61), 'fast');
  assert.equal(SPEED_MIN_SAMPLES, 3);

  // Fewer than SPEED_MIN_SAMPLES (3) qualifying calls -> median is omitted (null)
  const twoCalls = summarizeConversationTps([
    [1000, 'gemini-4-neon', 1000, 0, 0, 1000, 2, 8, 'Gemini 4 Neon', 'r1'], // 100 tok/s
    [2000, 'gemini-4-neon', 1000, 0, 0, 600, 2, 8, 'Gemini 4 Neon', 'r2'], // 60 tok/s
    [3000, 'gemini-4-neon', 1000, 0, 0, 40, 3, 0.2, 'Gemini 4 Neon', 'r3'], // skipped (<100 tok)
  ]);
  assert.equal(twoCalls.tps, 60);
  assert.equal(twoCalls.median, null);
  assert.equal(twoCalls.samples, 2);
  assert.equal(twoCalls.ttft, 2);
  assert.equal(twoCalls.total, 10);

  // 3+ qualifying calls: deduplicates rid and isolates median to the picked call's model
  const perModel = summarizeConversationTps([
    [1000, 'gemini-4-hydrogen', 1000, 0, 0, 2000, 1, 9, 'Gemini 4 Hydrogen', 'h1'], // 200 tok/s (different model!)
    [1500, 'gemini-4-hydrogen', 1000, 0, 0, 2200, 1, 9, 'Gemini 4 Hydrogen', 'h2'], // 220 tok/s (different model!)
    [2000, 'gemini-4-neon', 1000, 0, 0, 1000, 2, 8, 'Gemini 4 Neon', 'n1'], // 100 tok/s
    [2000, 'gemini-4-neon', 1000, 0, 0, 1000, 2, 8, 'Gemini 4 Neon', 'n1'], // duplicate rid -> ignored!
    [3000, 'gemini-4-neon', 1000, 0, 0, 800, 2, 8, 'Gemini 4 Neon', 'n2'], // 80 tok/s
    [4000, 'gemini-4-neon', 1000, 0, 0, 600, 2, 8, 'Gemini 4 Neon', 'n3'], // 60 tok/s
    [5000, 'gemini-4-neon', 1000, 0, 0, 40, 3, 0.2, 'Gemini 4 Neon', 'n4'], // short tool call -> skipped
  ]);
  assert.equal(perModel.tps, 60);
  assert.equal(perModel.median, 80); // median of Neon [60, 80, 100], excluding Hydrogen & duplicate n1!
  assert.equal(perModel.samples, 3);
  assert.equal(perModel.model, 'Gemini 4 Neon');
});

test('readTelemetry reads conversation SQLite DBs, deduplicates shared request IDs, caches by mtime, and isolates days', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agy-telemetry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const convDir = join(root, 'conversations');
  mkdirSync(convDir, { recursive: true });
  const cacheFile = join(root, 'agy-cli-statusline', 'telemetry-cache.json');

  const now = new Date(2026, 10, 26, 15, 0, 0).getTime(); // local 2026-11-26 15:00
  const todaySec = Math.floor(new Date(2026, 10, 26, 10, 0, 0).getTime() / 1000);
  const yesterdaySec = Math.floor(new Date(2026, 10, 25, 22, 0, 0).getTime() / 1000);

  const conv1 = '11111111-1111-1111-1111-111111111111';
  const conv2 = '22222222-2222-2222-2222-222222222222';
  const db1 = join(convDir, `${conv1}.db`);
  const db2 = join(convDir, `${conv2}.db`);

  // conv1 spans yesterday + today with step_payload thinkingDuration:
  // - yesterday call: 1M input Neon = $3.00 (counts in sessionCostUsd, excluded from todayCost!)
  // - today call 1 (thinking, thinkDur=0 -> total=10s): 1000 out -> 100 tok/s
  // - today call 2 (thinking, thinkDur=2s < ttft=4s -> span=2+6=8s): 800 out -> 100 tok/s!
  writeConvDb(db1, {
    withStepPayload: true,
    steps: [
      { idx: 1, sec: yesterdaySec, exec: 'e0', thinkDur: 3 },
      { idx: 2, sec: todaySec, exec: 'e1' },
      { idx: 3, sec: todaySec + 60, exec: 'e1', thinkDur: 2 },
    ],
    gens: [
      {
        steps: [1], exec: 'e0', model: 'gemini-4-neon', disp: 'Gemini 4 Neon (High)',
        usage: { inp: 1_000_000, out: 1000, think: 200, vis: 800, rid: 'req-yest' }, ttft: 2, stream: 8, // thinkDur=3 >= ttft=2 -> span=10 -> 100 tok/s
      },
      {
        steps: [2], exec: 'e1', model: 'gemini-4-neon', disp: 'Gemini 4 Neon (High)',
        usage: { inp: 1_000_000, cr: 0, cw: 0, out: 1000, think: 300, vis: 700, rid: 'req-shared' }, ttft: 2, stream: 8, // no thinkDur -> span=10 -> 100 tok/s
      },
      {
        steps: [3], exec: 'e1', model: 'gemini-4-neon', disp: 'Gemini 4 Neon (High)',
        usage: { inp: 0, cr: 0, cw: 0, out: 100, think: 400, vis: 400, rid: 'req-2' }, ttft: 4, stream: 6, // max(100,800)=800; thinkDur=2 < ttft=4 -> span=2+6=8 -> 100 tok/s!
      },
    ],
  });

  // conv2 is a fork/subagent that duplicates 'req-shared' and adds its own Hydrogen call ($1.50 input + $0.0075 out)
  writeConvDb(db2, {
    steps: [
      { idx: 1, sec: todaySec, exec: 'e1' },
      { idx: 2, sec: todaySec + 120, exec: 'e2' },
    ],
    gens: [
      {
        steps: [1], exec: 'e1', model: 'gemini-4-neon',
        usage: { inp: 1_000_000, out: 1000, rid: 'req-shared' }, ttft: 2, stream: 8,
      },
      {
        steps: [2], exec: 'e2', model: 'gemini-4-hydrogen',
        usage: { inp: 1_000_000, out: 1000, rid: 'req-3' }, ttft: 1, stream: 4, // $1.5075
      },
    ],
  });

  // Ensure DB mtimes are within today
  const touchAt = new Date(todaySec * 1000 + 200_000);
  utimesSync(db1, touchAt, touchAt);
  utimesSync(db2, touchAt, touchAt);

  // Sanity-check raw DB tuple reading (including think & thinkDur from step_payload)
  const rawCalls = readConversationDb(DatabaseSync, db1);
  assert.equal(rawCalls.length, 3);
  assert.equal(rawCalls[2][5], 800); // max(out=100, think=400+vis=400)
  assert.equal(rawCalls[2][10], 400); // thinkingOutputTokens
  assert.equal(rawCalls[2][11], 2); // thinkingDuration from step_payload[20][11]

  const tel = await readTelemetry({
    conversationId: conv1,
    needTps: true,
    needTodayCost: true,
    needSessionCost: true,
    root,
    convDirs: [convDir],
    cacheFile,
    now,
  });

  // TPS for conv1: latest call req-2 has thinkDur=2 < ttft=4 -> span=2+6=8s -> 800/8 = 100 tok/s; median of 3 Neon calls [100, 100, 100] = 100
  assert.equal(tel.tps.tps, 100);
  assert.equal(tel.tps.ttft, 4);
  assert.equal(tel.tps.span, 8);
  assert.equal(tel.tps.median, 100);
  assert.equal(tel.tps.samples, 3);

  // Today cost: req-shared ($3.015, deduplicated!) + req-2 ($0.012) + req-3 ($1.5075) = $4.5345
  assert.equal(tel.todayCost.calls, 3);
  assert.equal(tel.todayCost.conversations, 2);
  assert.equal(Number(tel.todayCost.total_usd.toFixed(4)), 4.5345);

  // Session cost for conv1 includes yesterday ($3.015) + today ($3.015 + $0.012) = $6.042
  assert.equal(Number(tel.sessionCostUsd.toFixed(4)), 6.042);

  // Cache file was written and re-used on second call
  assert.equal(existsSync(cacheFile), true);
  const cachedJson = JSON.parse(readFileSync(cacheFile, 'utf8'));
  assert.equal(cachedJson.version, 2);
  assert.equal(Object.keys(cachedJson.files).length, 2);

  // Render segments with templates
  const prefs = normalizePreferences({
    preset: 'cometix',
    segments: ['tps', 'cost', 'cost.today'],
    items: {
      tps: { format: '{tps} tok/s[ · {ttft}][ · med {median}]' },
      'cost.today': { format: '{usd} today[ · {calls} calls]' },
    },
  });
  const segs = collectSegments({}, prefs, null, { telemetry: tel, now });
  const rendered = stripAnsi(renderLine(segs, prefs, { width: 160, env: {} }));
  assert.match(rendered, /100 tok\/s · 4\.0s · med 100/);
  assert.match(rendered, /\$6\.042/);
  assert.match(rendered, /\$4\.53 today · 3 calls/);

  // Path traversal in conversationId is rejected safely
  const bad = await readTelemetry({
    conversationId: '../../etc/passwd',
    needTps: true,
    root,
    convDirs: [convDir],
    cacheFile: null,
    now,
  });
  assert.equal(bad.tps, null);
});

test('summarizeConversationCache computes session hit ratio, warm/cold TTL, miss causes, and rewarm cost', () => {
  // No caching observed returns null
  assert.equal(summarizeConversationCache([
    [1_000_000, 'gemini-4-neon', 50_000, 0, 0, 500, 1, 2, 'Gemini 4 Neon', 'r1'],
  ], 1_060_000), null);

  // Realistic session: initial write -> warm hit -> compaction miss -> warm hit
  const t0 = 1_790_812_000_000;
  const calls = [
    [t0, 'gemini-4-neon', 100_000, 0, 0, 500, 1, 2, 'Gemini 4 Neon', 'c1'],
    [t0 + 20_000, 'gemini-4-neon', 5_000, 100_000, 0, 500, 1, 2, 'Gemini 4 Neon', 'c2'],
    [t0 + 40_000, 'gemini-4-neon', 40_000, 0, 0, 500, 1, 2, 'Gemini 4 Neon', 'c3'], // compaction: 40k < 0.6 * 105k
    [t0 + 60_000, 'gemini-4-neon', 5_000, 40_000, 0, 500, 1, 2, 'Gemini 4 Neon', 'c4'],
  ];
  // 78s after c4 finished (c4 finished at t0 + 63_000) -> 222s left (3:42)
  const warmNow = t0 + 63_000 + 78_000;
  const warmSummary = summarizeConversationCache(calls, warmNow);
  assert.equal(warmSummary.warm, true);
  assert.equal(warmSummary.ttl, '5m');
  assert.equal(warmSummary.requests, 4);
  assert.equal(warmSummary.misses, 1);
  assert.deepEqual(warmSummary.last_miss_cause, { causes: ['compaction'] });
  // sum(cr) = 140k, sum(inp+cr+cw) = 290k -> 140/290 = 0.4827...
  assert.equal(Math.round(warmSummary.hit_ratio * 100), 48);
  // rewarm: 45k tokens * $3/M = $0.135 -> $0.14
  assert.equal(formatMoney(warmSummary.rewarm_usd), '$0.14');

  // After 5m TTL passes, cache becomes cold
  const coldSummary = summarizeConversationCache(calls, t0 + 63_000 + 310_000);
  assert.equal(coldSummary.warm, false);

  // Model switch and TTL expiration miss causes
  const multiMiss = summarizeConversationCache([
    [t0, 'gemini-4-neon', 100_000, 0, 0, 500, 1, 2, 'Gemini 4 Neon', 'm1'],
    [t0 + 10_000, 'gemini-4-hydrogen', 100_000, 0, 0, 500, 1, 2, 'Gemini 4 Hydrogen', 'm2'], // model_switch
    [t0 + 400_000, 'gemini-4-hydrogen', 100_000, 5_000, 0, 500, 1, 2, 'Gemini 4 Hydrogen', 'm3'], // ttl_expired_5m
  ], t0 + 410_000);
  assert.equal(multiMiss.misses, 2);
  assert.deepEqual(multiMiss.last_miss_cause, { causes: ['ttl_expired_5m'] });

  // Claude rewarm pricing for 5m and 1h TTLs
  assert.equal(formatMoney(estimateRewarmUsd(182_000, 'claude-opus-4-8', '5m', t0)), '$1.14');
  assert.equal(formatMoney(estimateRewarmUsd(270_000, 'claude-opus-5-5[1m]', '1h', t0)), '$2.16');
  assert.equal(formatMoney(0.005), '$0');
  assert.equal(formatMoney(123.4), '$123');
});
