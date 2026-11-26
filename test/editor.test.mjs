import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { stripAnsi } from '../lib/ansi.mjs';
import { confirmReplace, runEditor, selectLanguage } from '../lib/editor.mjs';
import { normalizePreferences, presetRows } from '../lib/preferences.mjs';

function terminal() {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = raw => { stdin.isRaw = raw; };
  const stdout = new EventEmitter();
  stdout.isTTY = true;
  stdout.columns = 80;
  stdout.rows = 24;
  return { stdin, stdout };
}

for (const surface of [runEditor, confirmReplace]) {
  test(`${surface.name} restores the terminal when its first draw fails`, async () => {
    const { stdin, stdout } = terminal();
    const frames = [];
    stdout.write = frame => {
      if (frame.startsWith('\x1b[2J')) throw new Error('draw failed');
      frames.push(frame);
    };
    const signals = process.listenerCount('SIGTERM');
    await assert.rejects(surface({ stdin, stdout }), /draw failed/);
    assert.equal(stdin.isRaw, false);
    assert.match(frames.at(-1), /\x1b\[\?25h\x1b\[\?1049l/);
    assert.equal(stdin.listenerCount('keypress'), 0);
    assert.equal(stdout.listenerCount('resize'), 0);
    assert.equal(process.listenerCount('SIGTERM'), signals);
  });
}

test('an interrupted save reports the completed write', async () => {
  const { stdin, stdout } = terminal();
  stdout.write = () => true;
  const originalExitCode = process.exitCode;
  let finishSave;
  try {
    const result = runEditor({
      stdin, stdout,
      onSave: () => new Promise(resolve => { finishSave = resolve; }),
    });
    stdin.emit('keypress', 's', { name: 's', ctrl: true });
    process.emit('SIGTERM');
    assert.equal(stdin.isRaw, true);
    finishSave();
    assert.equal((await result).saved, true);
    assert.equal(stdin.isRaw, false);
  } finally {
    process.exitCode = originalExitCode;
  }
});

function press(stdin, text, key) {
  stdin.emit('keypress', text, key);
}

test('the startup prompts handle Enter and Esc', async () => {
  const zh = terminal();
  zh.stdout.write = () => true;
  const selected = selectLanguage(zh);
  press(zh.stdin, '2', { name: '2' });
  press(zh.stdin, '\r', { name: 'return' });
  assert.equal(await selected, 'zh');
  assert.equal(zh.stdin.isRaw, false);

  for (const dialog of [selectLanguage, confirmReplace]) {
    const io = terminal();
    io.stdout.write = () => true;
    const result = dialog(io);
    press(io.stdin, undefined, { name: 'escape' });
    assert.equal(await result, dialog === selectLanguage ? null : false);
    assert.equal(io.stdin.isRaw, false);
  }
});

function frameText(stdout) {
  return stripAnsi(stdout.frames.at(-1));
}

test('the layout panel grabs, moves, and restores one segment without wrapping', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 100;
  stdout.rows = 36;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'dashboard' }),
    stdin, stdout,
    onSave: async (preferences) => { saved = preferences; },
  });
  for (let step = 0; step < 7; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  assert.match(frameText(stdout), /Segment layout/);
  assert.match(frameText(stdout), /Cost\s+enabled\s+row 1 right/);
  for (let step = 0; step < 3; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  press(stdin, undefined, { name: 'up' });
  assert.match(frameText(stdout), /> Cost\s+held\s+row 1 left/);
  press(stdin, undefined, { name: 'escape' });
  assert.match(frameText(stdout), /Cost\s+enabled\s+row 1 right/);
  assert.doesNotMatch(frameText(stdout), /held/);
  press(stdin, '\r', { name: 'return' });
  press(stdin, undefined, { name: 'up' });
  press(stdin, undefined, { name: 'up' });
  press(stdin, undefined, { name: 'up' });
  press(stdin, '\r', { name: 'return' });
  assert.match(frameText(stdout), /> Cost\s+enabled\s+row 1 left/);
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  assert.match(frameText(stdout), /> Quota\s+off/);
  press(stdin, ' ', {});
  assert.match(frameText(stdout), /> Quota\s+enabled\s+row 3 left/);
  press(stdin, undefined, { name: 'down' });
  assert.doesNotMatch(frameText(stdout), /Quota\s+enabled\s+row 1/);
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.deepEqual(saved.layout, [[3, 1], [2, 1], [2, 0]]);
  assert.deepEqual(saved.segments, ['cost', 'model', 'dir', 'git', 'context', 'quota.5h', 'cache', 'worktree', 'quota']);
  assert.deepEqual(presetRows(saved).map((row) => row.left.map((item) => item.metric)), [
    ['cost', 'model', 'dir'], ['context', 'quota.5h'], ['worktree', 'quota'],
  ]);
  assert.equal(stdin.isRaw, false);
});

test('the editor configures the context format and updates the live preview', async () => {
  for (const [language, label, value] of [
    ['en', 'context', '% · used/total'],
    ['zh', '上下文', '百分比 · 已用/上限'],
  ]) {
    const { stdin, stdout } = terminal();
    stdout.columns = 100;
    stdout.rows = 30;
    const frames = [];
    stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
    let saved;
    const result = runEditor({
      preferences: normalizePreferences({ preset: 'powerline' }),
      stdin, stdout, language,
      onSave: async (preferences) => { saved = preferences; },
    });
    for (let step = 0; step < 5; step += 1) press(stdin, undefined, { name: 'down' });
    press(stdin, undefined, { name: 'left' });
    assert.match(frameText(stdout), new RegExp(`> ${label}\\s+${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(frameText(stdout), /42% · 84k\/200k/);
    press(stdin, '\r', { name: 'return' });
    assert.equal((await result).saved, true);
    assert.equal(saved.contextFormat, 'ratio');
    assert.equal(stdin.isRaw, false);
  }
});

test('the editor toggles 5h and 7d quota pace estimates in the live preview', async () => {
  for (const [language, label, hideLabel, showLabel] of [
    ['en', 'quota pace', 'hide', 'show (⇡/⇣)'],
    ['zh', '配额估算', '隐藏', '显示 (⇡/⇣)'],
  ]) {
    const { stdin, stdout } = terminal();
    stdout.columns = 120;
    stdout.rows = 30;
    const frames = [];
    stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
    let saved;
    const result = runEditor({
      preferences: normalizePreferences({ preset: 'budget' }),
      stdin, stdout, language,
      onSave: async (preferences) => { saved = preferences; },
    });
    assert.match(frameText(stdout), /5h 38% ⇡19%/);
    assert.match(frameText(stdout), /7d 82% ⇡27%/);
    for (let step = 0; step < 6; step += 1) press(stdin, undefined, { name: 'down' });
    press(stdin, undefined, { name: 'left' });
    assert.match(frameText(stdout), new RegExp(`> ${label}\\s+${hideLabel}`));
    assert.match(frameText(stdout), /5h 38%/);
    assert.match(frameText(stdout), /7d 82%/);
    assert.doesNotMatch(frameText(stdout), /⇡19%|⇡27%/);
    press(stdin, '\r', { name: 'return' });
    assert.equal((await result).saved, true);
    assert.equal(saved.quotaPace, 'hide');
    assert.equal(stdin.isRaw, false);

    const pwr = terminal();
    pwr.stdout.columns = 120;
    pwr.stdout.rows = 30;
    const pwrFrames = [];
    pwr.stdout.write = (frame) => { pwrFrames.push(String(frame)); pwr.stdout.frames = pwrFrames; return true; };
    let pwrSaved;
    const pwrResult = runEditor({
      preferences: normalizePreferences({ preset: 'powerline' }),
      stdin: pwr.stdin, stdout: pwr.stdout, language,
      onSave: async (preferences) => { pwrSaved = preferences; },
    });
    assert.doesNotMatch(frameText(pwr.stdout), /⇡19%/);
    for (let step = 0; step < 6; step += 1) press(pwr.stdin, undefined, { name: 'down' });
    press(pwr.stdin, undefined, { name: 'right' });
    assert.match(frameText(pwr.stdout), new RegExp(`> ${label}\\s+${showLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(frameText(pwr.stdout), /5h 38% ⇡19%/);
    press(pwr.stdin, '\r', { name: 'return' });
    assert.equal((await pwrResult).saved, true);
    assert.equal(pwrSaved.quotaPace, 'show');
    assert.equal(pwr.stdin.isRaw, false);
  }
});
