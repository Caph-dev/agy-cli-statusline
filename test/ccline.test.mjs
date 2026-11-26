import assert from 'node:assert/strict';
import test from 'node:test';
import { colorDepth, paint, stripAnsi, visibleWidth } from '../lib/ansi.mjs';
import { CCLINE_PALETTES, CCLINE_PRESETS } from '../lib/ccline-data.mjs';
import { normalizePreferences, presetRows } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { SAMPLE_GIT, samplePayload } from '../lib/sample.mjs';
import { collectSegments } from '../lib/segments.mjs';

function render(options, payload = samplePayload(), width = 120) {
  const preferences = normalizePreferences(options);
  const segments = collectSegments(payload, preferences, payload.vcs?.type === 'git' ? SAMPLE_GIT : null);
  return renderLine(segments, preferences, { width, env: {} });
}

test('all upstream named presets render, keeping their supported rows and color modes', () => {
  assert.deepEqual(Object.keys(CCLINE_PRESETS), ['cometix', 'minimal', 'dashboard', 'budget', 'cache-aware', 'focus', 'zen', 'powerline']);
  for (const id of Object.keys(CCLINE_PRESETS)) assert.notEqual(render({ preset: id }).trim(), '', id);
  const dashboard = render({ preset: 'dashboard', colorDepth: '256' }, samplePayload(), 160);
  const rows = dashboard.split('\n');
  assert.equal(rows.length, 3);
  assert.match(stripAnsi(rows[0]), /Gemini.*main.*\$1\.284/);
  assert.match(stripAnsi(rows[1]), /42%.*5h.*cache/);
  assert.match(stripAnsi(rows[2]), /atlas-feature/);
  assert.equal(visibleWidth(rows[0]), 160);
  assert.match(dashboard, /48;5;\d+/);
  assert.match(dashboard, /▀/);
  assert.match(render({ preset: 'zen' }), /^[\x20-\x7e]+$/);
  assert.doesNotMatch(render({ preset: 'minimal', colorDepth: 'none' }), /◆|◔|≈|\x1b/);
});

test('the 13 upstream palettes retain exact RGB data and have a 256-color rendering', () => {
  assert.deepEqual(Object.keys(CCLINE_PALETTES), [
    'terminal', 'catppuccin-mocha', 'catppuccin-latte', 'dracula', 'nord', 'tokyo-night', 'rose-pine', 'gruvbox',
    'anthropic-clay', 'powerline-dark', 'powerline-light', 'powerline-rose-pine', 'powerline-tokyo-night',
  ]);
  assert.deepEqual(CCLINE_PALETTES['powerline-tokyo-night'].segments.identity, ['#191b29', '#fca7ea']);
  assert.match(render({ preset: 'powerline', colorDepth: 'truecolor' }), /38;2;252;167;234;48;2;25;27;41/);
  for (const theme of Object.keys(CCLINE_PALETTES).filter(name => name !== 'terminal')) {
    assert.match(render({ preset: 'minimal', theme, colorDepth: '256' }), /\x1b\[38;5;\d+m/, theme);
  }
  assert.equal(paint('#444444', '256:208', 'x', '256'), '\x1b[38;5;238;48;5;208mx\x1b[0m');
  assert.equal(paint('16:14', '16:0', 'x', '256'), '\x1b[96;40mx\x1b[0m');
  assert.equal(colorDepth('auto', { env: { TERM: 'xterm-256color' } }), '256');
  assert.equal(colorDepth('auto', { env: { COLORTERM: 'truecolor' } }), 'truecolor');
  assert.equal(colorDepth('256', { env: { NO_COLOR: '1' } }), 'none');
});

test('missing telemetry hides unused rows and anonymous quotas stay anonymous', () => {
  const quota = { quota: { unknown: { remaining_fraction: 0.1, reset_in_seconds: 3600 } } };
  assert.equal(render({ preset: 'budget' }, quota), '');
  assert.equal(render({ preset: 'dashboard' }, { model: { display_name: 'A' } }).split('\n').length, 1);
  const input = { context_window: { used_percentage: 0.8, total_input_tokens: 700, total_output_tokens: 100 } };
  assert.match(stripAnsi(render({ preset: 'cometix' }, input)), /1% · 800 tokens/);
  for (const width of [1, 10, 35, 80]) {
    for (const id of Object.keys(CCLINE_PRESETS)) {
      const rows = render({ preset: id }, samplePayload(), width).split('\n');
      for (const row of rows) assert.ok(visibleWidth(row) <= width, `${id}, ${width}, ${stripAnsi(row)}`);
    }
  }
});

test('quota windows display usage and the original five-cell gauge rounds as before', () => {
  const quota = { quota: { 'gemini-5h': { remaining_fraction: 0.8 } } };
  assert.match(stripAnsi(render({ preset: 'budget' }, quota)), /5h 20%/);
  const input = { context_window: { used_percentage: 19 } };
  assert.match(stripAnsi(render({ preset: 'focus-legacy' }, input)), /19% #----/);
});

test('preset layout keeps row slots while a legacy custom order stays flat', () => {
  const dashboard = normalizePreferences({ preset: 'dashboard' });
  const moved = normalizePreferences({ ...dashboard, segments: ['model', 'dir', 'cost', 'git', 'context', 'quota.5h', 'cache', 'worktree'], layout: 'preset' });
  assert.equal(moved.layout, 'preset');
  assert.deepEqual(presetRows(moved)[0].right.map((item) => item.metric), ['git']);
  assert.equal(presetRows(moved)[1].left[0].bar, 'eighths');
  const acrossRows = normalizePreferences({ ...moved,
    segments: ['model', 'dir', 'cost', 'context', 'git', 'quota.5h', 'cache', 'worktree'],
    layout: [[3, 1], [2, 1], [1, 0]],
  });
  assert.deepEqual(presetRows(acrossRows)[0].right[0], { metric: 'context', bar: 'eighths', cells: 10 });
  const removed = normalizePreferences({ ...acrossRows,
    segments: acrossRows.segments.filter(metric => metric !== 'cost'), layout: [[2, 1], [2, 1], [1, 0]],
  });
  assert.deepEqual(presetRows(removed)[0].left.map(item => item.metric), ['model', 'dir']);
  assert.equal(presetRows(removed)[0].right[0].metric, 'context');
  assert.throws(() => normalizePreferences({ ...removed, layout: [[3, 1]] }), /layout counts/);
  const extended = normalizePreferences({ preset: 'minimal', segments: ['model', 'context', 'cache', 'cost', 'state'], layout: 'preset' });
  assert.equal(presetRows(extended).length, 2);
  assert.deepEqual(presetRows(extended)[1].left.map((item) => item.metric), ['state']);
  const legacy = normalizePreferences({ preset: 'dashboard', segments: ['worktree', 'model'] });
  assert.equal(legacy.layout, undefined);
  assert.equal(presetRows(legacy).length, 1);
  assert.throws(() => normalizePreferences({ preset: 'dashboard', layout: 'grid' }), /unknown layout/);
});

test('version-one Focus migrates without overwriting custom settings', () => {
  const previous = normalizePreferences({ version: 1, preset: 'focus', skin: 'bracket' });
  assert.equal(previous.preset, 'focus-legacy');
  assert.equal(previous.skin, 'bracket');
  assert.deepEqual(previous.segments, ['model', 'dir', 'git', 'context']);
  const current = normalizePreferences({ preset: 'focus', colorDepth: '256' });
  assert.equal(presetRows(current).length, 2);
  assert.equal(current.colorDepth, '256');
});

test('context format supports percent, used tokens, and used/total ratio with fallbacks', () => {
  const payload = {
    model: { display_name: 'Model' },
    context_window: {
      used_percentage: 68,
      current_usage: { input_tokens: 340_000, output_tokens: 0 },
      total_input_tokens: 900_000,
      total_output_tokens: 50_000,
      context_window_size: 500_000,
    },
  };
  assert.match(stripAnsi(render({ preset: 'powerline', contextFormat: 'ratio' }, payload)), /68% · 340k\/500k/);
  assert.match(stripAnsi(render({ preset: 'dashboard', contextFormat: 'ratio' }, payload)), /68% · 340k\/500k/);
  assert.match(stripAnsi(render({ preset: 'cometix', contextFormat: 'ratio' }, payload)), /68% · 340k\/500k/);
  assert.doesNotMatch(stripAnsi(render({ preset: 'cometix', contextFormat: 'ratio' }, payload)), /tokens/);
  assert.match(stripAnsi(render({ preset: 'minimal', contextFormat: 'ratio' }, payload)), /68% · 340k\/500k/);
  assert.match(stripAnsi(render({ preset: 'studio', contextFormat: 'ratio' }, payload)), /68% · 340k\/500k/);
  assert.match(stripAnsi(render({ preset: 'dashboard', contextFormat: 'percent' }, payload)), /68%/);
  assert.doesNotMatch(stripAnsi(render({ preset: 'dashboard', contextFormat: 'percent' }, payload)), /340k/);
  assert.match(stripAnsi(render({ preset: 'minimal', contextFormat: 'tokens' }, payload)), /68% · 340k/);
  assert.doesNotMatch(stripAnsi(render({ preset: 'minimal', contextFormat: 'tokens' }, payload)), /500k/);

  const fresh = {
    context_window: { used_percentage: 0, current_usage: { input_tokens: 0 }, context_window_size: 1_000_000 },
  };
  assert.match(stripAnsi(render({ preset: 'powerline', contextFormat: 'ratio' }, fresh)), /0% · 0\/1M/);

  const noSize = {
    context_window: { used_percentage: 68, current_usage: { input_tokens: 340_000 } },
  };
  assert.match(stripAnsi(render({ preset: 'powerline', contextFormat: 'ratio' }, noSize)), /68% · 340k/);
  assert.doesNotMatch(stripAnsi(render({ preset: 'powerline', contextFormat: 'ratio' }, noSize)), /\//);

  const noTokens = {
    context_window: { used_percentage: 68, context_window_size: 500_000 },
  };
  assert.match(stripAnsi(render({ preset: 'powerline', contextFormat: 'ratio' }, noTokens)), /68%/);
  assert.doesNotMatch(stripAnsi(render({ preset: 'powerline', contextFormat: 'ratio' }, noTokens)), /·/);

  assert.throws(() => normalizePreferences({ contextFormat: 'invalid' }), /unknown context format/);
});
