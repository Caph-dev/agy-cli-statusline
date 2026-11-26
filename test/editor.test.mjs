import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { stripAnsi } from '../lib/ansi.mjs';
import { confirmReplace, runEditor, selectLanguage } from '../lib/editor.mjs';
import { ITEM_ICON_PRESETS, normalizePreferences, presetRows, SEGMENT_IDS } from '../lib/preferences.mjs';

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
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
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

test('the editor configures the directory style and updates the live preview', async () => {
  for (const [language, label, value] of [
    ['en', 'dir style', 'name'],
    ['zh', '目录样式', '仅末级'],
  ]) {
    const { stdin, stdout } = terminal();
    stdout.columns = 120;
    stdout.rows = 30;
    const frames = [];
    stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
    let saved;
    const result = runEditor({
      preferences: normalizePreferences({ preset: 'cometix' }),
      stdin, stdout, language,
      onSave: async (preferences) => { saved = preferences; },
    });
    for (let step = 0; step < 7; step += 1) press(stdin, undefined, { name: 'down' });
    press(stdin, undefined, { name: 'right' });
    assert.match(frameText(stdout), new RegExp(`> ${label}\\s+${value}`));
    assert.doesNotMatch(frameText(stdout), /…\/atlas/);
    assert.match(frameText(stdout), /\batlas\b/);
    press(stdin, '\r', { name: 'return' });
    assert.equal((await result).saved, true);
    assert.equal(saved.dirStyle, 'name');
    assert.equal(stdin.isRaw, false);
  }
});

test('the layout editor modifies widget, icon, and format on enabled segments with live preview', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 120;
  stdout.rows = 32;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'dashboard' }),
    stdin, stdout,
    onSave: async (preferences) => { saved = preferences; },
  });

  // Open layout mode (field index 8 = segments)
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  assert.match(frameText(stdout), /Segment layout/);

  // Model (index 0) does NOT support multiple widgets, so widget control is hidden
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /Edit segment: Model/);
  assert.doesNotMatch(frameText(stdout), /\bwidget\b/);
  assert.match(frameText(stdout), /\bicon\b/);
  assert.match(frameText(stdout), /\bformat\b/);
  press(stdin, undefined, { name: 'escape' });
  assert.match(frameText(stdout), /Segment layout/);

  // Move to Context (index 4 in dashboard: model, dir, git, cost, context)
  for (let step = 0; step < 4; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /Edit segment: Context/);
  assert.match(frameText(stdout), /> widget\s+default \(bar\)/);
  assert.match(frameText(stdout), /▏/); // eighths bar is visible in preview

  // Cycle widget: default (bar) -> gauge (icon control hides because gauge replaces icon!)
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> widget\s+gauge/);
  assert.doesNotMatch(frameText(stdout), /\bicon\b/);
  assert.doesNotMatch(frameText(stdout), /▏/);

  // Cycle widget: gauge -> text (icon control returns, bar stays gone!)
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> widget\s+text/);
  assert.match(frameText(stdout), /\bicon\b/);

  // Move to icon and cycle to none (""), then type custom icon '*'
  press(stdin, undefined, { name: 'down' });
  assert.match(frameText(stdout), /> icon/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> icon\s+\(none\)/);
  press(stdin, '\r', { name: 'return' });
  press(stdin, '*', {});
  assert.match(frameText(stdout), /\* 42%/);
  press(stdin, '\r', { name: 'return' });

  // Move to format, cycle to ratio, then type custom format and verify Esc restores
  press(stdin, undefined, { name: 'down' });
  assert.match(frameText(stdout), /> format/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /42% · 84k\/200k/);

  // Test inline typing with Backspace and Esc cancel
  press(stdin, '\r', { name: 'return' });
  press(stdin, '!', {});
  assert.match(frameText(stdout), /42% · 84k\/200k!/);
  press(stdin, undefined, { name: 'escape' });
  assert.doesNotMatch(frameText(stdout), /200k!/);

  // Type a custom template using {left} and commit with Enter
  press(stdin, '\r', { name: 'return' });
  for (let i = 0; i < 40; i += 1) press(stdin, undefined, { name: 'backspace' });
  for (const ch of '{pct}% ({left} left)') press(stdin, ch, {});
  assert.match(frameText(stdout), /42% \(116k left\)/);
  press(stdin, '\r', { name: 'return' });

  // Return to layout: Context shows custom marker
  press(stdin, undefined, { name: 'escape' });
  assert.match(frameText(stdout), /Context\s+enabled\s+row 2 left · custom/);

  // Pressing 'e' on a disabled segment (Quota) does not open the block editor
  for (let step = 0; step < 4; step += 1) press(stdin, undefined, { name: 'down' });
  assert.match(frameText(stdout), /> Quota\s+off/);
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /Segment layout/);

  // Save with Ctrl-S and verify persisted items
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.deepEqual(saved.items, {
    context: { widget: 'text', icon: '*', format: '{pct}% ({left} left)' },
  });
  assert.equal(stdin.isRaw, false);
});

test('the editor displays dynamic ring (gauge) as the default context widget in cometix with localized hint', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 120;
  stdout.rows = 30;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix', segments: ['context'] }),
    stdin, stdout, language: 'zh',
    onSave: async () => {},
  });
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  press(stdin, 'e', { name: 'e' });
  const frame = frameText(stdout);
  assert.match(frame, /> 组件\s+默认 \(gauge\)\s+动态圆环/);
  assert.match(frame, /\u{f0aa0} 42% · 84k tokens/u);
  assert.doesNotMatch(frame, /\b图标\b/);
  press(stdin, 'q', { name: 'q' });
  assert.equal((await result).saved, false);
});

test('the layout editor supports Chinese single-block labels and r reset', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 120;
  stdout.rows = 30;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'budget' }),
    stdin, stdout, language: 'zh',
    onSave: async (preferences) => { saved = preferences; },
  });
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  // Edit first enabled segment (quota.5h)
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /编辑区块：5 小时配额/);
  assert.match(frameText(stdout), /> 组件\s+默认 \(pace\)/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> 组件\s+bar/);
  // Reset back to default with r
  press(stdin, 'r', { name: 'r' });
  assert.match(frameText(stdout), /> 组件\s+默认 \(pace\)/);
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.equal(saved.items, undefined);
});

test('the editor preview wraps full styles on narrow terminals and resolves sample home paths to ~', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 70;
  stdout.rows = 24;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  const result = runEditor({
    preferences: normalizePreferences({
      preset: 'cometix',
      layout: 'flat',
      segments: ['model', 'context', 'cache', 'dir', 'git', 'worktree', 'quota.5h', 'quota.7d', 'cost'],
    }),
    stdin, stdout, language: 'zh',
    onSave: async () => {},
  });
  const initial = frameText(stdout);
  assert.match(initial, /\uef23 Gemini 2\.5 Pro high/);
  assert.match(initial, /\u{f0aa0} 42% · 84k tokens/u);
  assert.doesNotMatch(initial, /▰|▱/);
  assert.match(initial, /\u{f024b} ~\/…\/atlas/u);
  assert.match(initial, /\uf1c0 3:42 · 94% hit/);
  assert.match(initial, /\u{f0520} ▀▀▀▀▀▀▀▀ 7d 82% ⇡27% · 3d3h/u);

  // Move to dirStyle (index 7) and switch to tilde (~) and short (~/s/atlas)
  for (let step = 0; step < 7; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, undefined, { name: 'right' }); // name
  press(stdin, undefined, { name: 'right' }); // parent
  press(stdin, undefined, { name: 'right' }); // tilde
  assert.match(frameText(stdout), /~\/src\/atlas/);
  press(stdin, undefined, { name: 'right' }); // short
  assert.match(frameText(stdout), /~\/s\/atlas/);

  press(stdin, 'q', { name: 'q' });
  assert.equal((await result).saved, false);
  assert.equal(stdin.isRaw, false);
});

test('the editor enables and previews tps and cost.today with custom format templates', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 120;
  stdout.rows = 32;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({
      preset: 'cometix',
      segments: ['model', 'tps', 'cost.today'],
    }),
    stdin, stdout, language: 'zh',
    onSave: async (preferences) => { saved = preferences; },
  });
  assert.match(frameText(stdout), /84 tok\/s/);
  assert.match(frameText(stdout), /\$8\.42 today/);

  // Open layout, edit tps (index 1), cycle format to include {ttft}
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  press(stdin, undefined, { name: 'down' });
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /编辑区块：生成速度/);
  press(stdin, undefined, { name: 'down' }); // move from icon -> format
  press(stdin, undefined, { name: 'right' }); // "{tps} tok/s[ · {ttft}]"
  assert.match(frameText(stdout), /84 tok\/s · 1\.8s/);
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.equal(saved.items.tps.format, '{tps} tok/s[ · {ttft}]');
});

test('every segment provides 3-5 unique Nerd Font icon alternatives and cycles cleanly in the block editor', async () => {
  for (const id of SEGMENT_IDS) {
    const list = ITEM_ICON_PRESETS[id];
    assert.ok(Array.isArray(list), `missing ITEM_ICON_PRESETS for ${id}`);
    assert.ok(list.length >= 3 && list.length <= 5, `${id} should have 3-5 alternatives, got ${list.length}`);
    const glyphs = new Set();
    for (const entry of list) {
      assert.equal(typeof entry.glyph, 'string');
      assert.ok(entry.glyph.length > 0, `empty glyph for ${id}`);
      assert.match(entry.name, /^nf-/);
      assert.equal(glyphs.has(entry.glyph), false, `duplicate glyph in ${id}`);
      glyphs.add(entry.glyph);
    }
  }

  // Verify cycling on cache (which previously had duplicate undefineds) and saving a Nerd Font preset icon
  const { stdin, stdout } = terminal();
  stdout.columns = 120;
  stdout.rows = 32;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix', segments: ['cache'] }),
    stdin, stdout, language: 'zh',
    onSave: async (preferences) => { saved = preferences; },
  });
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  press(stdin, 'e', { name: 'e' });
  // Cache now supports widget cycling (text -> bar -> gauge) as well as icons
  assert.match(frameText(stdout), /> 组件\s+默认 \(text\)/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> 组件\s+bar/);
  press(stdin, 'r', { name: 'r' });
  assert.match(frameText(stdout), /> 组件\s+默认 \(text\)/);
  press(stdin, undefined, { name: 'down' });
  assert.match(frameText(stdout), /> 图标\s+默认/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> 图标\s+（无）/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /nf-md-database_outline/);
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /nf-md-lightning_bolt_outline/);
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.equal(saved.items.cache.icon, '\u{f140c}');
});

test('the editor previews and configures the subagents tree and inline widgets', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 120;
  stdout.rows = 32;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix', segments: ['model', 'subagents'] }),
    stdin, stdout, language: 'zh',
    onSave: async (preferences) => { saved = preferences; },
  });
  // Main preview shows aligned subagent tree lines
  assert.match(frameText(stdout), /├ .*research · Codebase Reviewer/);
  assert.match(frameText(stdout), /└ .*explore · Dependency Audit/);

  // Open layout, select subagents (index 1), press 'e' to edit
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  press(stdin, undefined, { name: 'down' });
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /编辑区块：子代理/);
  assert.match(frameText(stdout), /> 组件\s+默认 \(tree\)\s+树形多行/);
  assert.doesNotMatch(frameText(stdout), /模板/); // hidden in tree mode

  // Switch widget from tree -> inline: format control appears and preview becomes single-line summary
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /> 组件\s+inline\s+单行汇总/);
  assert.match(frameText(stdout), /模板/);
  assert.match(frameText(stdout), /1 running · 1 done/);

  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.deepEqual(saved.items, { subagents: { widget: 'inline' } });
});

test('the editor wraps git available fields cleanly, previews diff stats across combinations, and saves custom format', async () => {
  const { stdin, stdout } = terminal();
  stdout.columns = 80;
  stdout.rows = 30;
  const frames = [];
  stdout.write = (frame) => { frames.push(String(frame)); stdout.frames = frames; return true; };
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix', segments: ['model', 'git'] }),
    stdin, stdout, language: 'zh',
    onSave: async (preferences) => { saved = preferences; },
  });

  // Open layout -> select Git (index 1) -> edit
  for (let step = 0; step < 8; step += 1) press(stdin, undefined, { name: 'down' });
  press(stdin, '\r', { name: 'return' });
  press(stdin, undefined, { name: 'down' });
  press(stdin, 'e', { name: 'e' });

  const initialFrame = frameText(stdout);
  assert.match(initialFrame, /编辑区块：Git/);
  assert.match(initialFrame, /\{files\}/);
  assert.match(initialFrame, /\{added\}/);
  assert.match(initialFrame, /\{deleted\}/);

  // Move from icon -> format and cycle to first diff-stat combination
  press(stdin, undefined, { name: 'down' });
  press(stdin, undefined, { name: 'right' });
  assert.match(frameText(stdout), /main \* ↑1 2f08999 · 4f \+128 -34/);

  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.equal(saved.items.git.format, '{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}][ · {files}f[ {added}][ {deleted}]]');
});
