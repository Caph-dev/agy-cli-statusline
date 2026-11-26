import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/agy-cli-statusline.mjs', import.meta.url));

function fixture(t, settings) {
  const directory = mkdtempSync(join(tmpdir(), "agy status's test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'settings.json');
  if (settings !== undefined) writeFileSync(settingsPath, JSON.stringify(settings));
  const env = { ...process.env, AGY_CLI_STATUSLINE_HOME: directory, NO_COLOR: '1' };
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    env, encoding: 'utf8', timeout: 5000,
  });
  const read = () => JSON.parse(readFileSync(settingsPath, 'utf8'));
  const render = payload => spawnSync('sh', ['-c', read().statusLine.command], {
    env, input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
  });
  return { directory, settingsPath, run, read, render };
}

function succeeded(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('the npm-style bin symlink invokes the CLI', t => {
  const f = fixture(t);
  const link = join(f.directory, 'agy-cli-statusline');
  symlinkSync(cli, link);
  const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.match(succeeded(result), /agy-cli-statusline configure/);
});

test('registration preserves agy settings and the installed renderer accepts agy JSON', t => {
  const f = fixture(t, { colorScheme: 'terminal', autoUpdate: false });
  succeeded(f.run('configure', '--icons', 'ascii', '--segments', 'model,context'));
  const first = f.read();
  assert.equal(first.colorScheme, 'terminal');
  assert.equal(first.autoUpdate, false);
  assert.equal(first.statusLine.type, 'command');

  const payload = {
    model: { display_name: 'Fixture Model' },
    context_window: { used_percentage: 0, current_usage: { input_tokens: 0 }, context_window_size: 1_000_000 },
    terminal_width: 80,
  };
  const visible = succeeded(f.render(payload));
  assert.match(visible, /Fixture Model/);
  assert.match(visible, /0%/);
  assert.doesNotMatch(visible, /\x1b/);
  const untrusted = succeeded(f.render({
    ...payload,
    model: { display_name: 'First\nSecond\x1b[2J\x9b' },
  }));
  assert.match(untrusted, /First Second/);
  assert.doesNotMatch(untrusted.trimEnd(), /[\r\n\x1b\x9b]/);

  const narrow = succeeded(f.render({ ...payload, terminal_width: 18 }));
  const narrowLines = narrow.trimEnd().split('\n');
  assert.ok(narrowLines.length >= 2, narrow);
  for (const line of narrowLines) assert.ok(line.length <= 18, line);
  assert.match(narrow, /Fixture Model/);
  assert.match(narrow, /0%/);
  assert.doesNotMatch(succeeded(f.render({ model: null, context_window: null })), /undefined|NaN|null/);

  const original = readFileSync(f.settingsPath, 'utf8');
  succeeded(f.run('configure', '--icons', 'ascii', '--segments', 'model,context'));
  assert.equal(readFileSync(f.settingsPath, 'utf8'), original);
});

test('read-only and failed commands leave existing settings untouched', t => {
  const f = fixture(t);
  assert.doesNotThrow(() => JSON.parse(succeeded(f.run('configure', '--show'))));
  assert.equal(existsSync(f.settingsPath), false);
  const malformed = '{"statusLine":';
  writeFileSync(f.settingsPath, malformed);
  assert.notEqual(f.run('configure').status, 0);
  assert.equal(readFileSync(f.settingsPath, 'utf8'), malformed);
});

test('an explicit replacement backs up another status line', t => {
  const previous = {
    statusLine: { type: 'command', command: 'node /other/agy-cli-statusline/custom.mjs' },
    unrelated: true,
  };
  const f = fixture(t, previous);
  assert.notEqual(f.run('configure').status, 0);
  assert.deepEqual(f.read(), previous);
  assert.deepEqual(readdirSync(f.directory), ['settings.json']);

  succeeded(f.run('configure', '--replace'));
  assert.notEqual(f.read().statusLine.command, previous.statusLine.command);
  assert.equal(f.read().unrelated, true);
  const backup = readdirSync(f.directory).find(name => name.startsWith('settings.json.'));
  assert.ok(backup, 'original settings backup should exist');
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory, backup), 'utf8')), previous);
});

test('configure --context-format persists ratio formatting to the installed renderer', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'powerline', '--context-format', 'ratio'));
  const shown = JSON.parse(succeeded(f.run('configure', '--show')));
  assert.equal(shown.preferences.contextFormat, 'ratio');
  assert.deepEqual(shown.enums.contextFormat, ['auto', 'percent', 'tokens', 'ratio']);

  const output = succeeded(f.render({
    model: { display_name: 'Fixture Model' },
    context_window: {
      used_percentage: 68,
      current_usage: { input_tokens: 340_000, output_tokens: 0 },
      context_window_size: 500_000,
    },
    terminal_width: 100,
  }));
  assert.match(output, /68% · 340k\/500k/);
});

test('configure --quota-pace persists pace delta visibility to the installed renderer', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'budget', '--quota-pace', 'hide'));
  const shown = JSON.parse(succeeded(f.run('configure', '--show')));
  assert.equal(shown.preferences.quotaPace, 'hide');
  assert.deepEqual(shown.enums.quotaPace, ['auto', 'show', 'hide']);

  const output = succeeded(f.render({
    quota: [
      { id: 'gemini-5h', label: '5h', remaining_fraction: 0.70, reset_in_seconds: 13_500 },
      { id: 'gemini-weekly', label: 'weekly', remaining_fraction: 0.80, reset_in_seconds: 163_296 },
    ],
    terminal_width: 100,
  }));
  assert.match(output, /5h 30%/);
  assert.match(output, /7d 20%/);
  assert.doesNotMatch(output, /[⇡⇣±]/);
});

test('configure --dir-style persists directory style to the installed renderer', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix', '--dir-style', 'parent'));
  const shown = JSON.parse(succeeded(f.run('configure', '--show')));
  assert.equal(shown.preferences.dirStyle, 'parent');
  assert.deepEqual(shown.enums.dirStyle, ['auto', 'name', 'parent', 'tilde', 'short', 'full']);

  const output = succeeded(f.render({
    workspace: { current_dir: '/Users/ada/src/atlas' },
    terminal_width: 100,
  }));
  assert.match(output, /src\/atlas/);
});

test('installed renderer applies persisted per-segment items overrides from statusline.json', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix'));
  const prefsPath = join(f.directory, 'agy-cli-statusline', 'statusline.json');
  const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
  prefs.items = {
    context: { widget: 'text', icon: '#', format: '{pct}% ({left} free)' },
  };
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));

  const output = succeeded(f.render({
    model: { display_name: 'Fixture Model' },
    context_window: {
      used_percentage: 42,
      current_usage: { input_tokens: 84_000, output_tokens: 0 },
      context_window_size: 200_000,
    },
    terminal_width: 120,
  }));
  assert.match(output, /# 42% \(116k free\)/);
});

test('installed renderer computes live tps, cache stats, session cost fallback, and today cost from local SQLite conversations', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix', '--icons', 'none', '--segments', 'model,cache,tps,cost,cost.today'));
  const convId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const convDir = join(f.directory, 'conversations');
  mkdirSync(convDir, { recursive: true });
  const db = new DatabaseSync(join(convDir, `${convId}.db`));
  db.exec('create table steps (idx integer, metadata blob); create table gen_metadata (data blob);');
  const varint = (n) => {
    const out = [];
    let v = n;
    do { let b = v % 128; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v);
    return Buffer.from(out);
  };
  const fv = (field, n) => Buffer.concat([varint(field * 8), varint(n)]);
  const fb = (field, v) => {
    const buf = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
    return Buffer.concat([varint(field * 8 + 2), varint(buf.length), buf]);
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const dur = (s) => Buffer.concat([fv(1, Math.floor(s)), fv(2, Math.round((s % 1) * 1e9))]);
  // Call 1 (90s ago): 100k uncached input ($0.30) + 1k out ($0.015)
  db.prepare('insert into steps values (?, ?)').run(1, Buffer.concat([fb(1, fv(1, nowSec - 90)), fb(12, 'exec-1')]));
  const u1 = Buffer.concat([fv(2, 100_000), fv(3, 1000), fb(11, 'req-live-1')]);
  const cm1 = Buffer.concat([fb(4, u1), fb(11, dur(1)), fb(12, dur(4)), fb(19, 'gemini-4-neon'), fb(21, 'Gemini 4 Neon')]);
  db.prepare('insert into gen_metadata values (?)').run(Buffer.concat([fb(1, cm1), fb(2, varint(1)), fb(4, 'exec-1')]));
  // Call 2 (20s ago): 400k uncached ($1.20) + 100k cache read ($0.015) + 2k out ($0.03, with thinking -> span=2+8=10s -> 200 tok/s) -> total session $1.56, hit = 100k/600k = 17%
  db.prepare('insert into steps values (?, ?)').run(2, Buffer.concat([fb(1, fv(1, nowSec - 20)), fb(12, 'exec-2')]));
  const u2 = Buffer.concat([fv(2, 400_000), fv(3, 2000), fv(5, 100_000), fv(9, 400), fv(10, 1600), fb(11, 'req-live-2')]);
  const cm2 = Buffer.concat([fb(4, u2), fb(11, dur(2)), fb(12, dur(8)), fb(19, 'gemini-4-neon'), fb(21, 'Gemini 4 Neon')]);
  db.prepare('insert into gen_metadata values (?)').run(Buffer.concat([fb(1, cm2), fb(2, varint(2)), fb(4, 'exec-2')]));
  db.close();

  const output = succeeded(f.render({
    conversation_id: convId,
    model: { display_name: 'Gemini 4 Neon' },
    terminal_width: 140,
  }));
  // Warm countdown (~4:50), 17% hit, 200 tok/s, $1.560 session, $1.56 today
  assert.match(output, /4:[345]\d · 17% hit/);
  assert.match(output, /200 tok\/s/);
  assert.match(output, /\$1\.560/);
  assert.match(output, /\$1\.56 today/);
});

test('installed renderer enriches payload.subagents with local conversation_summaries.db and subagent DB metrics', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix', '--icons', 'ascii', '--segments', 'model,subagents'));
  const rootId = '11111111-2222-3333-4444-555555555555';
  const subId = '66666666-7777-8888-9999-aaaaaaaaaaaa';
  const convDir = join(f.directory, 'conversations');
  mkdirSync(convDir, { recursive: true });

  const nowSec = Math.floor(Date.now() / 1000);
  const varint = (n) => {
    const out = [];
    let v = n;
    do { let b = v % 128; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v);
    return Buffer.from(out);
  };
  const fv = (field, n) => Buffer.concat([varint(field * 8), varint(n)]);
  const fb = (field, v) => {
    const buf = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
    return Buffer.concat([varint(field * 8 + 2), varint(buf.length), buf]);
  };
  const dur = (s) => Buffer.concat([fv(1, Math.floor(s)), fv(2, Math.round((s % 1) * 1e9))]);

  const sdb = new DatabaseSync(join(f.directory, 'conversation_summaries.db'));
  sdb.exec(`
    create table conversation_summaries (
      conversation_id text primary key,
      title text not null default '',
      step_count integer not null default 0,
      last_modified_time datetime not null,
      status text not null default '',
      agent_name text not null default '',
      parent_conversation_id text not null default '',
      nesting_depth integer not null default 0,
      killed numeric not null default false,
      raw_summary blob
    );
  `);
  const rawSum = Buffer.concat([fb(3, fv(1, nowSec - 2)), fb(7, fv(1, nowSec - 75))]);
  sdb.prepare('insert into conversation_summaries values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    subId, 'Repo Scanner', 8, new Date((nowSec - 2) * 1000).toISOString(), 'CASCADE_RUN_STATUS_RUNNING', 'research', rootId, 1, 0, rawSum,
  );
  sdb.close();

  const db = new DatabaseSync(join(convDir, `${subId}.db`));
  db.exec('create table steps (idx integer, metadata blob); create table gen_metadata (data blob);');
  db.prepare('insert into steps values (?, ?)').run(1, Buffer.concat([fb(1, fv(1, nowSec - 30)), fb(12, 'se1')]));
  const u = Buffer.concat([fv(2, 20_000), fv(3, 500), fv(5, 80_000), fb(11, 'sub-req-1')]);
  const cm = Buffer.concat([fb(4, u), fb(11, dur(1)), fb(12, dur(3)), fb(19, 'gemini-4-neon'), fb(21, 'Gemini 4 Neon')]);
  db.prepare('insert into gen_metadata values (?)').run(Buffer.concat([fb(1, cm), fb(2, varint(1)), fb(4, 'se1')]));
  db.close();

  const output = succeeded(f.render({
    conversation_id: rootId,
    model: { id: 'gemini-4-neon', display_name: 'Gemini 4 Neon' },
    context_window: { context_window_size: 200_000 },
    subagents: [{ name: 'research', role: 'Repo Scanner', status: 'running' }],
    terminal_width: 140,
  }));
  const lines = output.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Gemini 4 Neon/);
  assert.match(lines[1], /\\- research \/ Repo Scanner \| Gemini 4 Neon \| 50% \/ 100k \| 80% hit \| \$0\.08 \| \* 1m1[456]s/);
});

test('installed renderer computes live git diff stats from the workspace repository', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix', '--icons', 'ascii', '--segments', 'git'));
  const prefsPath = join(f.directory, 'agy-cli-statusline', 'statusline.json');
  const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
  prefs.items = { git: { format: '{branch}[ · {files}f[ {added}][ {deleted}]]' } };
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));

  const repo = mkdtempSync(join(tmpdir(), 'agy-install-git-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const runGit = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  runGit('init', '-b', 'main');
  runGit('config', 'user.email', 'test@example.com');
  runGit('config', 'user.name', 'Test User');
  writeFileSync(join(repo, 'app.txt'), 'one\ntwo\n');
  runGit('add', 'app.txt');
  runGit('commit', '-m', 'init');
  writeFileSync(join(repo, 'app.txt'), 'one\ntwo-edited\nthree\n');
  writeFileSync(join(repo, 'extra.txt'), 'x\ny\n');

  const output = succeeded(f.render({
    workspace: { current_dir: repo },
    terminal_width: 120,
  }));
  assert.match(output, /^main \/ 2f \+4 -1\n?$/);
});

test('installed renderer applies persisted cache hit-only format overrides from statusline.json', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix', '--icons', 'none', '--segments', 'cache'));
  const prefsPath = join(f.directory, 'agy-cli-statusline', 'statusline.json');
  const payload = {
    prompt_cache: {
      warm: true,
      caching_observed: true,
      ttl: '5m',
      expires_in_seconds: 210,
      requests: 10,
      hit_ratio: 0.81,
    },
    terminal_width: 120,
  };

  for (const [format, expected] of [
    ['{hit}% hit', '81% hit'],
    ['{hit}%', '81%'],
  ]) {
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
    prefs.items = { cache: { format } };
    writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
    const output = succeeded(f.render(payload)).trim();
    assert.equal(output, expected);
  }
});

test('configure supports multi-row --segments with / and | and --layout on built-in and upstream presets', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'studio', '--icons', 'none', '--segments', 'model,dir,git / context,cost'));
  const shown = JSON.parse(succeeded(f.run('configure', '--show')));
  assert.deepEqual(shown.preferences.layout, [[3, 0], [2, 0]]);
  assert.ok(Array.isArray(shown.enums.layout));

  const payload = {
    model: { display_name: 'Fixture Model' },
    workspace: { current_dir: '/Users/ada/src/atlas' },
    context_window: { used_percentage: 42 },
    cost: { total_usd: 1.284 },
    terminal_width: 120,
  };
  const wide = succeeded(f.render(payload)).trimEnd().split('\n');
  assert.equal(wide.length, 2);
  assert.match(wide[0], /Fixture Model.*atlas/);
  assert.match(wide[1], /42%.*\$1\.284/);

  const narrow = succeeded(f.render({ ...payload, terminal_width: 24 })).trimEnd().split('\n');
  assert.ok(narrow.length >= 3, narrow.join('\n'));
  for (const line of narrow) assert.ok(line.length <= 24, line);
  const ctxRow = narrow.findIndex(line => line.includes('42%'));
  assert.ok(ctxRow >= 2, narrow.join('\n'));
  assert.match(narrow[ctxRow], /^\s*◑ 42%/);

  // Left/right split via '|' and '/'
  succeeded(f.run('configure', '--preset', 'cometix', '--icons', 'none', '--segments', 'model,dir | cost / context'));
  const splitShown = JSON.parse(succeeded(f.run('configure', '--show')));
  assert.deepEqual(splitShown.preferences.layout, [[2, 1], [1, 0]]);
  const splitOut = succeeded(f.render({ ...payload, terminal_width: 80 })).trimEnd().split('\n');
  assert.equal(splitOut.length, 2);
  assert.match(splitOut[0], /^Fixture Model.*\$1\.284$/);
  assert.match(splitOut[1], /^◑ 42%/);

  // Explicit --layout 2,2 and --layout flat
  succeeded(f.run('configure', '--preset', 'studio', '--segments', 'model,dir,context,cost', '--layout', '2,2'));
  assert.deepEqual(JSON.parse(succeeded(f.run('configure', '--show'))).preferences.layout, [[2, 0], [2, 0]]);
  succeeded(f.run('configure', '--layout', 'flat'));
  assert.equal(JSON.parse(succeeded(f.run('configure', '--show'))).preferences.layout, 'flat');

  // Mismatched --layout exits non-zero without touching saved preferences
  const before = JSON.parse(succeeded(f.run('configure', '--show'))).preferences;
  const bad = f.run('configure', '--layout', '3,3');
  assert.equal(bad.status, 2);
  assert.deepEqual(JSON.parse(succeeded(f.run('configure', '--show'))).preferences, before);

  // preview outputs 2 lines without writing files
  const preview = fixture(t);
  const previewOut = succeeded(preview.run('preview', '--preset', 'studio', '--icons', 'none', '--segments', 'model,dir / context,cost')).trimEnd().split('\n');
  assert.equal(previewOut.length, 2);
  assert.equal(existsSync(preview.settingsPath), false);
});
