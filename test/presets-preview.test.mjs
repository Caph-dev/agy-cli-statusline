import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { clipAnsi, fitAnsi, stripAnsi, visibleWidth } from '../lib/ansi.mjs';
import { runEditor } from '../lib/editor.mjs';
import { normalizePreferences, presetRows } from '../lib/preferences.mjs';
import { PresetLibrary, applyPreset, isPresetInUse, matchesPreset, slugifyPresetName } from '../lib/presets-library.mjs';
import { PreviewController } from '../lib/tui-preview.mjs';

function terminal(columns = 120, rows = 34) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (raw) => { stdin.isRaw = raw; };
  const stdout = new EventEmitter();
  stdout.isTTY = true;
  stdout.columns = columns;
  stdout.rows = rows;
  const frames = [];
  stdout.frames = frames;
  stdout.write = (frame) => {
    frames.push(String(frame));
    return true;
  };
  return { stdin, stdout };
}

function press(stdin, text, key = {}) {
  stdin.emit('keypress', text, key);
}

function frameText(stdout) {
  return stripAnsi(stdout.frames.at(-1));
}

function rawFrame(stdout) {
  return stdout.frames.at(-1);
}

test('clipAnsi and fitAnsi preserve ANSI codes, handle wide CJK/Nerd glyphs, add ellipsis, and reset style bleed', () => {
  const colored = '\x1b[38;2;255;0;0mHello \x1b[48;2;0;0;255mWorld!\x1b[0m';
  assert.equal(stripAnsi(clipAnsi(colored, 8)), 'Hello Wo');
  assert.match(clipAnsi(colored, 8), /\x1b\[38;2;255;0;0m/);
  assert.ok(clipAnsi(colored, 8).endsWith('\x1b[0m'));

  const ellipsized = clipAnsi('\x1b[32mABCDEFGHIJ\x1b[0m', 6, { ellipsis: true });
  assert.equal(stripAnsi(ellipsized), 'ABCDE…');
  assert.equal(visibleWidth(ellipsized), 6);

  // CJK wide chars (2 cells each) + Nerd Font glyph (2 cells in ansi.mjs)
  const wide = '\x1b[36m中文测试\x1b[0m';
  assert.equal(stripAnsi(clipAnsi(wide, 5)), '中文');
  assert.equal(stripAnsi(fitAnsi(clipAnsi(wide, 5), 6)), '中文  ');
  assert.equal(stripAnsi(fitAnsi(wide, 6)), '中文测');

  const nerd = '\x1b[44m\uef23 Opus\x1b[0m';
  const fitted = fitAnsi(nerd, 10);
  assert.equal(visibleWidth(fitted), 10);
  assert.ok(fitted.includes('\x1b[0m'));

  // Unterminated escape gets explicit reset in fitAnsi
  const unterminated = '\x1b[44mPowerline';
  const safeFit = fitAnsi(unterminated, 12);
  assert.equal(stripAnsi(safeFit), 'Powerline   ');
  assert.match(safeFit, /\x1b\[0m\s{3}$/);
});

test('presets gallery renders cards, filters tags, previews on hover, and applies all/layout/style with undo/redo', async () => {
  const { stdin, stdout } = terminal(118, 34);
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix' }),
    stdin,
    stdout,
    onSave: async (prefs) => { saved = prefs; },
  });

  const initial = frameText(stdout);
  for (const name of ['Cometix', 'Minimal', 'Dashboard', 'Budget', 'Cache-aware', 'Focus']) {
    assert.match(initial, new RegExp(name), `missing ${name}`);
  }
  assert.match(initial, /✓ in use/);
  assert.match(initial, /Classic look: model, directory, git, context and cache on one line/);
  assert.match(initial, /Preview\s+scenario ‹normal› width ‹fit 116›/);
  assert.match(initial, /·········1·········2/);

  // Enter the Presets page, move right to Minimal: hover preview updates without modifying config
  press(stdin, undefined, { name: 'down' });
  press(stdin, undefined, { name: 'right' });
  const hovered = frameText(stdout);
  assert.match(hovered, /Model, context, cache and cost, no icons/);
  assert.match(hovered, /Preview · minimal · enter applies/);
  assert.doesNotMatch(hovered, /statusline\.json \*/);

  // Move down to Budget (or Cache-aware in 3-col grid: row 1 col 1 is Cache-aware; row 1 col 0 is Budget)
  // Grid cols at 118 (innerW=116, CARD_MIN=34 => 3 cols): [0=Cometix, 1=Minimal, 2=Dashboard] / [3=Budget, 4=Cache-aware, 5=Focus]
  // Move right to Dashboard (index 2), press 's' to apply style only -> Cometix becomes "✓ in use, modified"
  press(stdin, undefined, { name: 'right' });
  press(stdin, 's', { name: 's' });
  const styleApplied = frameText(stdout);
  assert.match(styleApplied, /Applied the look of dashboard \(\^Z undoes\)/);
  assert.match(styleApplied, /✓ in use, modified/);
  assert.match(styleApplied, /statusline\.json \*/);

  // Undo (^Z) restores clean Cometix; Redo (^Y) re-applies
  press(stdin, 'z', { name: 'z', ctrl: true });
  assert.match(frameText(stdout), /Undid last change/);
  assert.match(frameText(stdout), /✓ in use(?!, modified)/);
  press(stdin, 'y', { name: 'y', ctrl: true });
  assert.match(frameText(stdout), /✓ in use, modified/);

  // Press 'l' on Dashboard to apply layout only -> adopts 3 rows while keeping Dashboard's or current style
  press(stdin, 'z', { name: 'z', ctrl: true }); // back to Cometix (plain/terminal)
  press(stdin, 'l', { name: 'l' });
  const layoutApplied = frameText(stdout);
  assert.match(layoutApplied, /Applied the layout of dashboard/);
  assert.match(layoutApplied, /✓ in use, modified/);

  // Filter to cache presets via Tab (all -> mine -> minimal -> multi-line -> powerline -> quota -> cache)
  for (let i = 0; i < 6; i += 1) press(stdin, '\t', { name: 'tab' });
  const cacheFiltered = frameText(stdout);
  assert.match(cacheFiltered, /● cache/);
  assert.match(cacheFiltered, /Cache-aware/);
  assert.doesNotMatch(cacheFiltered, /Minimal/);

  // Enter applies Cache-aware completely
  press(stdin, '\r', { name: 'return' });
  assert.match(frameText(stdout), /Applied cache-aware/);

  // Shift+Tab cycles backward to quota
  press(stdin, '\t', { name: 'tab', shift: true });
  assert.match(frameText(stdout), /● quota/);

  // Up from first row returns to tab bar
  press(stdin, undefined, { name: 'up' });
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.equal(saved.preset, 'cache-aware');
  assert.equal(presetRows(saved).length, 2);
});

test('presets gallery scrolls smoothly to bottom cards on a small 80x24 terminal', async () => {
  const { stdin, stdout } = terminal(80, 24);
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix' }),
    stdin,
    stdout,
    onSave: async () => {},
  });
  press(stdin, undefined, { name: 'down' });
  for (let i = 0; i < 8; i += 1) press(stdin, undefined, { name: 'down' });
  const s = frameText(stdout);
  assert.match(s, /Focus \(legacy\)|Bracket|Signal/);
  press(stdin, 'q', { name: 'q' });
  assert.equal((await result).saved, false);
});

test('user presets support N create, W replace, E rename, X/Delete delete, malformed files, and persistence', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-presets-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'broken.json'), '{bad json');

  const { stdin, stdout } = terminal(118, 34);
  let saved;
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix' }),
    stdin,
    stdout,
    presetsDir: dir,
    onSave: async (prefs) => { saved = prefs; },
  });

  const initial = frameText(stdout);
  assert.match(initial, /Broken/);
  assert.match(initial, /Can't read this file:/);

  // Enter Presets page, filter to mine -> broken appears
  press(stdin, undefined, { name: 'down' });
  press(stdin, '\t', { name: 'tab' });
  assert.match(frameText(stdout), /● mine/);
  // Pressing Enter on broken preset reports error toast
  press(stdin, '\r', { name: 'return' });
  assert.match(frameText(stdout), /Can't use broken/);

  // Switch back to all and verify built-in immutability toast on X
  press(stdin, '\t', { name: 'tab', shift: true });
  press(stdin, undefined, { name: 'right' }); // move onto Cometix
  press(stdin, 'x', { name: 'x' });
  assert.match(frameText(stdout), /Built-in presets stay as they are/);

  // Apply style of Dashboard onto Cometix, then press N to save as "Work Laptop"
  press(stdin, undefined, { name: 'right' });
  press(stdin, undefined, { name: 'right' });
  press(stdin, 's', { name: 's' });
  press(stdin, 'n', { name: 'n' });
  assert.match(frameText(stdout), /Save as preset/);
  for (const ch of 'cometix') press(stdin, ch, {});
  assert.match(frameText(stdout), /Built-in presets cannot be overwritten/);
  for (let i = 0; i < 7; i += 1) press(stdin, undefined, { name: 'backspace' });
  for (const ch of 'Work Laptop') press(stdin, ch, {});
  assert.match(frameText(stdout), /presets\/work-laptop\.json/);
  press(stdin, '\t', { name: 'tab' }); // focus summary
  for (const ch of 'Quota first') press(stdin, ch, {});
  press(stdin, '\r', { name: 'return' });

  const afterSave = frameText(stdout);
  assert.match(afterSave, /Saved preset work-laptop/);
  assert.match(afterSave, /Work-laptop/);
  assert.match(afterSave, /✓ in use/);
  assert.ok(existsSync(join(dir, 'work-laptop.json')));

  // Rename to office (E)
  press(stdin, 'e', { name: 'e' });
  assert.match(frameText(stdout), /Rename preset · work-laptop/);
  for (let i = 0; i < 'work-laptop'.length; i += 1) press(stdin, undefined, { name: 'backspace' });
  for (const ch of 'office') press(stdin, ch, {});
  press(stdin, '\r', { name: 'return' });
  assert.match(frameText(stdout), /Renamed work-laptop to office/);
  assert.ok(existsSync(join(dir, 'office.json')));
  assert.equal(existsSync(join(dir, 'work-laptop.json')), false);

  // Switch theme in Style tab -> office card becomes "✓ in use, modified", then W replaces it
  press(stdin, undefined, { name: 'escape' }); // back to tabs
  press(stdin, undefined, { name: 'right' }); // Layout
  press(stdin, undefined, { name: 'right' }); // Style
  press(stdin, undefined, { name: 'down' }); // enter Style
  press(stdin, undefined, { name: 'right' }); // cycle theme
  press(stdin, undefined, { name: 'escape' }); // back to tabs
  press(stdin, undefined, { name: 'left' });
  press(stdin, undefined, { name: 'left' }); // back to Presets
  press(stdin, undefined, { name: 'down' });
  // office (index 1 after broken) remains selected and now shows modified
  assert.match(frameText(stdout), /Office[\s\S]*✓ in use, modified/);
  press(stdin, 'w', { name: 'w' });
  assert.match(frameText(stdout), /Replace office with your current setup\?/);
  press(stdin, 'y', { name: 'y' });
  assert.match(frameText(stdout), /Replaced office/);
  assert.doesNotMatch(frameText(stdout), /in use, modified/);

  // Save with Ctrl-S and verify customPreset persists
  press(stdin, 's', { name: 's', ctrl: true });
  assert.equal((await result).saved, true);
  assert.equal(saved.customPreset, 'office');

  // Re-open in second session and delete office with X + y
  const second = terminal(118, 34);
  const res2 = runEditor({
    preferences: saved,
    stdin: second.stdin,
    stdout: second.stdout,
    presetsDir: dir,
    onSave: async () => {},
  });
  press(second.stdin, undefined, { name: 'down' });
  press(second.stdin, 'x', { name: 'x' });
  assert.match(frameText(second.stdout), /Delete office\?/);
  press(second.stdin, 'n', { name: 'n' });
  assert.ok(existsSync(join(dir, 'office.json')));
  press(second.stdin, undefined, { name: 'delete' });
  press(second.stdin, 'y', { name: 'y' });
  assert.equal(existsSync(join(dir, 'office.json')), false);
  assert.match(frameText(second.stdout), /Deleted office/);
  press(second.stdin, 'q', { name: 'q' });
  await res2;

  // Verify JSON stored on disk
  assert.equal(slugifyPresetName('  Work Laptop '), 'work-laptop');
  const lib = new PresetLibrary(dir);
  assert.equal(lib.get('office'), null);
  assert.ok(lib.get('broken').error);
});

test('live preview controls cycle scenarios, resize width & ruler, simulate color depth & glyphs, and handle narrow titles', async () => {
  const { stdin, stdout } = terminal(118, 34);
  const result = runEditor({
    preferences: normalizePreferences({ preset: 'cometix' }),
    stdin,
    stdout,
    onSave: async () => {},
  });

  // Cycle scenarios forward with ] -> fresh -> near-full
  press(stdin, ']', {});
  assert.match(frameText(stdout), /scenario ‹fresh›/);
  assert.match(frameText(stdout), /12% · 24k tokens/);
  press(stdin, ']', {});
  assert.match(frameText(stdout), /scenario ‹near-full›/);
  assert.match(frameText(stdout), /feature\/auth/);
  assert.match(frameText(stdout), /91% · 182k tokens/);
  // Cycle backward with [ -> fresh
  press(stdin, '[', {});
  assert.match(frameText(stdout), /scenario ‹fresh›/);
  // Cycle to non-git with [ x 2
  press(stdin, '[', {});
  press(stdin, '[', {});
  assert.match(frameText(stdout), /scenario ‹non-git›/);
  assert.match(frameText(stdout), /Gemini 4 Hydrogen/);

  // Resize width with - (shrinks by 4 from 116 -> 112) and + back to fit 116
  press(stdin, '-', {});
  assert.match(frameText(stdout), /width ‹112›/);
  press(stdin, '+', {});
  assert.match(frameText(stdout), /width ‹fit 116›/);

  // Simulate color depth ({) and glyphs (})
  press(stdin, '{', {});
  assert.match(frameText(stdout), /depth ‹true›/);
  assert.match(rawFrame(stdout), /\x1b\[38;2;/);
  press(stdin, '{', {});
  assert.match(frameText(stdout), /depth ‹256›/);
  press(stdin, '{', {});
  assert.match(frameText(stdout), /depth ‹16›/);
  press(stdin, '{', {});
  assert.match(frameText(stdout), /depth ‹none›/);

  press(stdin, '}', {});
  press(stdin, '}', {});
  assert.match(frameText(stdout), /glyphs ‹unicode›/);
  press(stdin, '}', {});
  assert.match(frameText(stdout), /glyphs ‹ascii›/);

  // Compact title drops labels when room is tight
  const pc = new PreviewController();
  pc.fit = 50;
  const compact = stripAnsi(pc.title(normalizePreferences({ preset: 'cometix' }), { room: 50 }));
  assert.match(compact, /Preview\s+‹normal› ‹fit 50›/);
  assert.doesNotMatch(compact, /scenario ‹/);

  press(stdin, 'q', { name: 'q' });
  await result;
});

test('help popup (?) and command palette (^P) work in both English and Chinese', async () => {
  for (const [language, helpHeading, cmdHeading] of [
    ['en', /Help · Presets/, /Command Palette/],
    ['zh', /快捷键帮助 · 预设/, /命令面板/],
  ]) {
    const { stdin, stdout } = terminal(110, 32);
    const result = runEditor({
      preferences: normalizePreferences({ preset: 'cometix' }),
      stdin,
      stdout,
      language,
      onSave: async () => {},
    });

    press(stdin, '?', {});
    assert.match(frameText(stdout), helpHeading);
    press(stdin, undefined, { name: 'escape' });
    assert.doesNotMatch(frameText(stdout), helpHeading);

    press(stdin, 'p', { name: 'p', ctrl: true });
    assert.match(frameText(stdout), cmdHeading);
    for (const ch of 'zen') press(stdin, ch, {});
    press(stdin, '\r', { name: 'return' });
    assert.match(frameText(stdout), /zen/i);

    press(stdin, 'q', { name: 'q' });
    await result;
  }
});

test('applyPreset and matchesPreset accurately track full, layout-only, and style-only modifications', () => {
  const lib = new PresetLibrary();
  const cometix = lib.get('cometix');
  const dashboard = lib.get('dashboard');
  const prefs = normalizePreferences({ preset: 'cometix' });

  assert.equal(isPresetInUse(prefs, cometix), true);
  assert.equal(matchesPreset(prefs, cometix), true);

  const styleOnly = applyPreset(prefs, dashboard, 'style');
  assert.equal(styleOnly.theme, 'catppuccin-mocha');
  assert.equal(styleOnly.skin, 'pill');
  assert.deepEqual(styleOnly.segments, prefs.segments);
  assert.equal(isPresetInUse(styleOnly, cometix), true);
  assert.equal(matchesPreset(styleOnly, cometix), false);

  const layoutOnly = applyPreset(prefs, dashboard, 'layout');
  assert.equal(layoutOnly.theme, 'terminal');
  assert.equal(layoutOnly.skin, 'plain');
  assert.equal(presetRows(layoutOnly).length, 3);
  assert.equal(layoutOnly.items?.context?.widget, 'bar');
  assert.equal(isPresetInUse(layoutOnly, cometix), true);
  assert.equal(matchesPreset(layoutOnly, cometix), false);

  const allApplied = applyPreset(layoutOnly, dashboard, 'all');
  assert.equal(isPresetInUse(allApplied, dashboard), true);
  assert.equal(matchesPreset(allApplied, dashboard), true);
});
