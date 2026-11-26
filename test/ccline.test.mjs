import assert from 'node:assert/strict';
import test from 'node:test';
import { colorDepth, paint, stripAnsi, visibleWidth } from '../lib/ansi.mjs';
import { CCLINE_PALETTES, CCLINE_PRESETS } from '../lib/ccline-data.mjs';
import { normalizePreferences, presetRows } from '../lib/preferences.mjs';
import { gaugeIcon, renderLine } from '../lib/render.mjs';
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
  assert.match(stripAnsi(rows[1]), /42%.*5h.*3:42 · 94% hit/);
  assert.match(stripAnsi(rows[2]), /atlas-feature/);
  assert.equal(visibleWidth(rows[0]), 160);
  assert.match(dashboard, /48;5;\d+/);
  assert.match(dashboard, /▀/);
  assert.match(render({ preset: 'zen' }), /^[\x20-\x7e]+$/);
  assert.match(stripAnsi(render({ preset: 'zen' })), /cache 3:42/);
  assert.doesNotMatch(render({ preset: 'minimal', colorDepth: 'none' }), /◆|◔|≈|\x1b/);
  assert.match(stripAnsi(render({ preset: 'minimal', colorDepth: 'none' })), /cache 3:42/);
  const cacheAware = stripAnsi(render({ preset: 'cache-aware' }, samplePayload(), 160));
  assert.match(cacheAware, /●●●●●○○○ warm 3:42 · 94% hit · 1× miss · last: tools changed/);
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
  const flatCometix = normalizePreferences({
    preset: 'cometix',
    layout: 'flat',
    segments: ['model', 'context', 'dir'],
  });
  assert.equal(presetRows(flatCometix).length, 1);
  assert.equal(presetRows(flatCometix)[0].left[1].widget, 'gauge');
  assert.equal(presetRows(flatCometix)[0].left[1].format, '{pct}%[ · {tokens} tokens]');
  assert.equal(presetRows(flatCometix)[0].left[2].icon_color, 'bright_yellow');
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

test('quota pace option toggles 5h and 7d pace deltas across presets', () => {
  const payload = {
    quota: [
      { id: 'gemini-5h', label: '5h', remaining_fraction: 0.70, reset_in_seconds: 13_500 },
      { id: 'gemini-weekly', label: 'weekly', remaining_fraction: 0.80, reset_in_seconds: 163_296 },
    ],
  };
  const budgetAuto = render({ preset: 'budget', colorDepth: '256' }, payload);
  assert.match(stripAnsi(budgetAuto), /5h 30% ⇡5%/);
  assert.match(stripAnsi(budgetAuto), /7d 20% ⇣53%/);
  assert.match(budgetAuto, /▀/);

  const budgetHidden = render({ preset: 'budget', colorDepth: '256', quotaPace: 'hide' }, payload);
  assert.match(stripAnsi(budgetHidden), /5h 30%/);
  assert.match(stripAnsi(budgetHidden), /7d 20%/);
  assert.doesNotMatch(stripAnsi(budgetHidden), /[⇡⇣±]/);
  assert.match(budgetHidden, /▀/);

  const powerlineAuto = stripAnsi(render({ preset: 'powerline' }, payload));
  assert.match(powerlineAuto, /5h 30%/);
  assert.doesNotMatch(powerlineAuto, /⇡5%/);

  const powerlineShow = stripAnsi(render({ preset: 'powerline', quotaPace: 'show' }, payload));
  assert.match(powerlineShow, /5h 30% ⇡5%/);

  const asciiHidden = stripAnsi(render({ preset: 'budget', icons: 'ascii', quotaPace: 'hide' }, payload));
  assert.match(asciiHidden, /5h 30%/);
  assert.match(asciiHidden, /7d 20%/);
  assert.doesNotMatch(asciiHidden, /[+-]\d+%/);

  const noReset = { quota: [{ id: 'gemini-5h', label: '5h', remaining_fraction: 0.70 }] };
  const shownNoReset = stripAnsi(render({ preset: 'budget', quotaPace: 'show' }, noReset));
  assert.match(shownNoReset, /5h 30%/);
  assert.doesNotMatch(shownNoReset, /[⇡⇣±]/);

  assert.throws(() => normalizePreferences({ quotaPace: 'invalid' }), /unknown quota pace/);
});

test('quota windows display reset countdowns even at zero usage or right after reset when ETA is unavailable', () => {
  // Zero usage right after reset: ETA is undefined, countdown is still meaningful
  const fresh = {
    quota: [
      { id: 'gemini-5h', label: '5h', remaining_fraction: 1.0, reset_in_seconds: 18_000 },
      { id: 'gemini-weekly', label: 'weekly', remaining_fraction: 1.0, reset_in_seconds: 604_800 },
    ],
  };
  const freshBudget = stripAnsi(render({ preset: 'budget' }, fresh, 160));
  assert.match(freshBudget, /5h 0% ±0% · 5h00m/);
  assert.match(freshBudget, /7d 0% ±0% · 7d0h/);
  assert.doesNotMatch(freshBudget, /ETA/);

  const freshHidden = stripAnsi(render({ preset: 'budget', quotaPace: 'hide' }, fresh, 160));
  assert.match(freshHidden, /5h 0% · 5h00m/);
  assert.match(freshHidden, /7d 0% · 7d0h/);

  // Zero usage partway through window: countdown and negative pace delta both show, still no ETA
  const idle = {
    quota: [{ id: 'gemini-5h', label: '5h', remaining_fraction: 1.0, reset_in_seconds: 9_000 }],
  };
  assert.match(stripAnsi(render({ preset: 'budget' }, idle, 160)), /5h 0% ⇣50% · 2h30m/);
  assert.doesNotMatch(stripAnsi(render({ preset: 'budget' }, idle, 160)), /ETA/);

  // Short durations (<1m and minutes) and combined quota segment
  const soon = {
    quota: [
      { id: 'gemini-5h', label: '5h', remaining_fraction: 0.6, reset_in_seconds: 45 },
      { id: 'gemini-weekly', label: 'weekly', remaining_fraction: 0.5, reset_in_seconds: 2_700 },
    ],
  };
  const soonBudget = stripAnsi(render({ preset: 'budget', quotaPace: 'hide' }, soon, 160));
  assert.match(soonBudget, /5h 40% · <1m/);
  assert.match(soonBudget, /7d 50% · 45m/);

  const studio = stripAnsi(render({ preset: 'studio', segments: ['quota'] }, soon, 120));
  assert.match(studio, /5h 60% weekly 50% · <1m/);

  // ASCII mode keeps output strictly ASCII
  const ascii = stripAnsi(render({ preset: 'budget', icons: 'ascii', quotaPace: 'hide' }, fresh, 160));
  assert.match(ascii, /5h 0% \/ 5h00m/);
  assert.match(ascii, /^[\x20-\x7e]+$/);
});

test('cache segment aligns with CCometixLine warm/cold countdown, hit ratio, misses, cause, rewarm, and bar/gauge widgets', () => {
  const baseNow = 1_790_812_800_000;
  const renderCache = (options, payload, width = 160) => {
    const prefs = normalizePreferences(options);
    const segs = collectSegments(payload, prefs, null, { now: baseNow });
    return {
      segs,
      text: stripAnsi(renderLine(segs, prefs, { width, color: false, env: {} })),
    };
  };

  // Warm cache with absolute expires_at, hit_ratio, misses, cause, and Claude rewarm pricing ($1.14)
  const warmPayload = {
    model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
    prompt_cache: {
      warm: true,
      caching_observed: true,
      ttl: '5m',
      expires_at: 1_790_813_022,
      requests: 41,
      misses: 1,
      hit_ratio: 0.94,
      last_miss_cause: { causes: ['tools_changed'] },
      recache_tokens_if_cold: 182_000,
    },
  };
  const warm = renderCache({ preset: 'cometix', segments: ['cache'] }, warmPayload);
  assert.equal(warm.segs[0].tone, 'normal');
  assert.equal(warm.segs[0].gauge, 74);
  assert.equal(warm.segs[0].fields.rewarm, '$1.14');
  assert.match(warm.text, /3:42 · 94% hit/);

  // Expiring soon (< 60s on 5m TTL) switches to warn tone
  const expiringPayload = {
    ...warmPayload,
    prompt_cache: { ...warmPayload.prompt_cache, expires_at: 1_790_812_842 },
  };
  const expiring = renderCache({ preset: 'cometix', segments: ['cache'] }, expiringPayload);
  assert.equal(expiring.segs[0].tone, 'warn');
  assert.match(expiring.text, /0:42 · 94% hit/);

  // Cold cache (warm: false) renders cold, 0% bar, warn tone, misses and cause
  const coldPayload = {
    ...warmPayload,
    prompt_cache: {
      warm: false,
      caching_observed: true,
      ttl: '5m',
      expires_at: null,
      requests: 210,
      misses: 6,
      hit_ratio: 0.71,
      last_miss_cause: { causes: ['ttl_expired_5m'] },
      recache_tokens_if_cold: 182_000,
    },
  };
  const coldAware = renderCache({ preset: 'cache-aware' }, coldPayload);
  assert.equal(coldAware.segs.find(s => s.id === 'cache').tone, 'warn');
  assert.equal(coldAware.segs.find(s => s.id === 'cache').gauge, 0);
  assert.match(coldAware.text, /○○○○○○○○ cold · 71% hit · 6× miss · last: ttl expired 5m/);

  // First request hides 0% hit ratio (exact CCometixLine behavior)
  const freshPayload = {
    prompt_cache: {
      warm: true,
      caching_observed: true,
      ttl: '5m',
      expires_at: 1_790_813_060,
      requests: 1,
      misses: 0,
      hit_ratio: 0.0,
    },
  };
  const fresh = renderCache({ preset: 'cometix', segments: ['cache'] }, freshPayload);
  assert.match(fresh.text, /4:20$/);
  assert.doesNotMatch(fresh.text, /hit/);

  // caching_observed: false hides the cache segment completely
  const unobserved = renderCache(
    { preset: 'cometix', segments: ['cache'] },
    { prompt_cache: { caching_observed: false, warm: false } },
  );
  assert.equal(unobserved.segs.length, 0);

  // current_usage-only fallback (no prompt_cache / no DB) computes hit% without orphan separator
  const usageOnly = renderCache(
    { preset: 'cometix', segments: ['cache'] },
    {
      context_window: {
        current_usage: {
          input_tokens: 63_382,
          output_tokens: 346,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 20_857,
        },
      },
    },
  );
  assert.equal(usageOnly.segs[0].fields.hit, '25');
  assert.equal(usageOnly.segs[0].fields.read, '20.9k');
  assert.match(usageOnly.text, /\uf1c0 25% hit$/);
  assert.doesNotMatch(usageOnly.text, /· 25%/);

  // Backward compatibility: custom {read}/{created} and {rewarm} templates continue to work
  const custom = renderCache(
    {
      preset: 'cometix',
      segments: ['cache'],
      items: { cache: { format: '[{left}][{cold}][ · rewarm {rewarm}][ · {read} read]' } },
    },
    { ...warmPayload, context_window: { current_usage: { cache_read_input_tokens: 120_988 } } },
  );
  assert.match(custom.text, /3:42 · rewarm \$1\.14 · 121k read/);

  // cache-aware preset keeps 1-to-1 layout counts with unique segments
  const awarePrefs = normalizePreferences({ preset: 'cache-aware' });
  const totalSlots = presetRows(awarePrefs).reduce((sum, row) => sum + row.left.length + row.right.length, 0);
  assert.equal(totalSlots, awarePrefs.segments.length);
  const asciiAware = renderCache({ preset: 'cache-aware', icons: 'ascii' }, warmPayload).text;
  assert.match(asciiAware, /^[\x20-\x7e\n]+$/);
});

test('context defaults to a dynamic proportional ring (gauge) with severity coloring', () => {
  // Nerd Font: 0% empty outline + 8 proportional slices (1/8 .. 8/8)
  assert.equal(gaugeIcon(0, 'nerd'), '\u{f0766}');
  assert.equal(gaugeIcon(1, 'nerd'), '\u{f0a9e}');
  assert.equal(gaugeIcon(25, 'nerd'), '\u{f0a9f}');
  assert.equal(gaugeIcon(42, 'nerd'), '\u{f0aa0}');
  assert.equal(gaugeIcon(50, 'nerd'), '\u{f0aa1}');
  assert.equal(gaugeIcon(75, 'nerd'), '\u{f0aa3}');
  assert.equal(gaugeIcon(100, 'nerd'), '\u{f0aa5}');

  // Unicode: 0% empty circle + 4 proportional quarters
  assert.equal(gaugeIcon(0, 'unicode'), '○');
  assert.equal(gaugeIcon(1, 'unicode'), '◔');
  assert.equal(gaugeIcon(42, 'unicode'), '◑');
  assert.equal(gaugeIcon(75, 'unicode'), '◕');
  assert.equal(gaugeIcon(100, 'unicode'), '●');

  // Default presets cometix, powerline, cache-aware, and studio use the dynamic ring for context
  for (const preset of ['cometix', 'powerline', 'cache-aware']) {
    const out = stripAnsi(render({ preset }, samplePayload(), 160));
    assert.match(out, /\u{f0aa0} 42%/u, preset);
  }
  assert.match(stripAnsi(render({ preset: 'studio' }, samplePayload(), 160)), /◑ 42%/);

  // Dynamic ring updates icon and color by usage severity (normal <70%, warn >=70%, crit >=90%)
  const renderCtx = (pct) => render(
    { preset: 'cometix', colorDepth: '16', segments: ['context'] },
    { context_window: { used_percentage: pct } },
    80,
  );
  // terminal palette: context = 16:13 (brightMagenta -> 95), warn = 16:3 (yellow -> 33), crit = 16:1 (red -> 31)
  assert.match(renderCtx(0), /\x1b\[95m\u{f0766}\x1b\[0m/u);
  assert.match(renderCtx(42), /\x1b\[95m\u{f0aa0}\x1b\[0m/u);
  assert.match(renderCtx(75), /\x1b\[33m\u{f0aa3}\x1b\[0m/u);
  assert.match(renderCtx(95), /\x1b\[31m\u{f0aa5}\x1b\[0m/u);
});
