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
  callSpeed,
  formatUsdToday,
  pbDur,
  pbGet,
  pbVarints,
  priceFor,
  quantile,
  readConversationDb,
  readTelemetry,
  speedTier,
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

function writeConvDb(file, { steps, gens }) {
  const db = new DatabaseSync(file);
  db.exec('create table steps (idx integer, metadata blob); create table gen_metadata (data blob);');
  const insStep = db.prepare('insert into steps values (?, ?)');
  for (const { idx, sec, exec = '' } of steps) {
    insStep.run(idx, Buffer.concat([fb(1, fv(1, sec)), ...(exec ? [fb(12, exec)] : [])]));
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

test('TPS calculation uses out / (ttft + stream), enforces thresholds, and computes quantiles and tiers', () => {
  assert.equal(callSpeed({ out: 1000, ttft: 4, stream: 6 }), 100);
  assert.equal(callSpeed({ out: 99, ttft: 1, stream: 1 }), null);
  assert.equal(callSpeed({ out: 500, ttft: 0.1, stream: 0.1 }), null);

  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10, 20, 30, 40], 0.5), 25);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);

  assert.equal(speedTier(29), 'slow');
  assert.equal(speedTier(30), 'medium');
  assert.equal(speedTier(60), 'medium');
  assert.equal(speedTier(61), 'fast');

  // Latest qualifying call wins over a tiny trailing tool call (<100 tok), while median aggregates qualifying calls
  const summary = summarizeConversationTps([
    [1000, 'gemini-4-neon', 1000, 0, 0, 1000, 2, 8, 'Gemini 4 Neon', 'r1'], // 100 tok/s
    [2000, 'gemini-4-neon', 1000, 0, 0, 600, 2, 8, 'Gemini 4 Neon', 'r2'], // 60 tok/s
    [3000, 'gemini-4-neon', 1000, 0, 0, 40, 3, 0.2, 'Gemini 4 Neon', 'r3'], // skipped (<100 tok)
  ]);
  assert.equal(summary.tps, 60);
  assert.equal(summary.median, 80);
  assert.equal(summary.samples, 2);
  assert.equal(summary.ttft, 2);
  assert.equal(summary.total, 10);
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

  // conv1 spans yesterday + today:
  // - yesterday call: 1M input Neon = $3.00 (counts in sessionCostUsd, excluded from todayCost!)
  // - today call 1: 1M input Neon ($3.00) + 100k out ($1.50) = $4.50, out=100k, ttft=2, stream=8 -> 10000? use realistic 1000 out = $0.015
  writeConvDb(db1, {
    steps: [
      { idx: 1, sec: yesterdaySec, exec: 'e0' },
      { idx: 2, sec: todaySec, exec: 'e1' },
      { idx: 3, sec: todaySec + 60, exec: 'e1' },
    ],
    gens: [
      {
        steps: [1], exec: 'e0', model: 'gemini-4-neon', disp: 'Gemini 4 Neon (High)',
        usage: { inp: 1_000_000, out: 1000, rid: 'req-yest' }, ttft: 2, stream: 8,
      },
      {
        steps: [2], exec: 'e1', model: 'gemini-4-neon', disp: 'Gemini 4 Neon (High)',
        usage: { inp: 1_000_000, cr: 0, cw: 0, out: 1000, rid: 'req-shared' }, ttft: 2, stream: 8, // $3.015, 100 tok/s
      },
      {
        steps: [3], exec: 'e1', model: 'gemini-4-neon', disp: 'Gemini 4 Neon (High)',
        usage: { inp: 0, cr: 0, cw: 0, out: 100, think: 400, vis: 400, rid: 'req-2' }, ttft: 4, stream: 6, // max(100,800)=800 out -> $0.012, 80 tok/s
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

  // Sanity-check raw DB tuple reading
  const rawCalls = readConversationDb(DatabaseSync, db1);
  assert.equal(rawCalls.length, 3);
  assert.equal(rawCalls[2][5], 800); // max(out=100, think=400+vis=400)

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

  // TPS for conv1: latest qualifying call is req-2 (800 / 10 = 80 tok/s); median of [80, 100, 100] = 100
  assert.equal(tel.tps.tps, 80);
  assert.equal(tel.tps.ttft, 4);
  assert.equal(tel.tps.median, 100);

  // Today cost: req-shared ($3.015, deduplicated!) + req-2 ($0.012) + req-3 ($1.5075) = $4.5345
  assert.equal(tel.todayCost.calls, 3);
  assert.equal(tel.todayCost.conversations, 2);
  assert.equal(Number(tel.todayCost.total_usd.toFixed(4)), 4.5345);

  // Session cost for conv1 includes yesterday ($3.015) + today ($3.015 + $0.012) = $6.042
  assert.equal(Number(tel.sessionCostUsd.toFixed(4)), 6.042);

  // Cache file was written and re-used on second call
  assert.equal(existsSync(cacheFile), true);
  const cachedJson = JSON.parse(readFileSync(cacheFile, 'utf8'));
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
  assert.match(rendered, /80 tok\/s · 4\.0s · med 100/);
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
