import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('installed renderer computes live tps, session cost fallback, and today cost from local SQLite conversations', t => {
  const f = fixture(t);
  succeeded(f.run('configure', '--preset', 'cometix', '--icons', 'none', '--segments', 'model,tps,cost,cost.today'));
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
  db.prepare('insert into steps values (?, ?)').run(1, Buffer.concat([fb(1, fv(1, nowSec)), fb(12, 'exec-1')]));
  const usage = Buffer.concat([fv(2, 500_000), fv(3, 2000), fb(11, 'req-live-1')]);
  const dur = (s) => Buffer.concat([fv(1, Math.floor(s)), fv(2, Math.round((s % 1) * 1e9))]);
  const cm = Buffer.concat([fb(4, usage), fb(11, dur(2)), fb(12, dur(8)), fb(19, 'gemini-4-neon'), fb(21, 'Gemini 4 Neon')]);
  db.prepare('insert into gen_metadata values (?)').run(Buffer.concat([fb(1, cm), fb(2, varint(1)), fb(4, 'exec-1')]));
  db.close();

  const output = succeeded(f.render({
    conversation_id: convId,
    model: { display_name: 'Gemini 4 Neon' },
    terminal_width: 120,
  }));
  // 2000 / (2 + 8) = 200 tok/s; 500k in ($1.50) + 2k out ($0.03) = $1.53
  assert.match(output, /200 tok\/s/);
  assert.match(output, /\$1\.530/);
  assert.match(output, /\$1\.53 today/);
});
