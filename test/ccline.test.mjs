import assert from 'node:assert/strict';
import test from 'node:test';
import { colorDepth, paint, stripAnsi, visibleWidth } from '../lib/ansi.mjs';
import { CCLINE_PALETTES, CCLINE_PRESETS } from '../lib/ccline-data.mjs';
import {
  ITEM_FORMAT_PRESETS,
  layoutModeOf,
  normalizePreferences,
  parseLayoutFlag,
  parseSegmentsAndLayout,
  presetHasStructuredLayout,
  presetRows,
  seedCustomLayout,
} from '../lib/preferences.mjs';
import { gaugeIcon, renderLine } from '../lib/render.mjs';
import { orchestratorSamplePayload, SAMPLE_GIT, samplePayload } from '../lib/sample.mjs';
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
  const renderCache = (options, payload, width = 160, telemetry = null) => {
    const prefs = normalizePreferences(options);
    const segs = collectSegments(payload, prefs, null, { now: baseNow, telemetry });
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

  // Session hit stays on the payload ratio. {read} stays on the last SQLite call,
  // even when that call's own ratio is 50% and current_usage is a different 42k snapshot.
  // A payload that only carries hit_ratio must not hide the DB last_read.
  const stableRead = renderCache(
    {
      preset: 'author',
      segments: ['cache'],
      items: { cache: { format: '{hit}% hit[ · {read} read]' } },
    },
    {
      prompt_cache: {
        warm: true,
        caching_observed: true,
        ttl: '5m',
        expires_at: 1_790_813_022,
        requests: 41,
        hit_ratio: 0.88,
      },
      context_window: {
        current_usage: {
          input_tokens: 8_000,
          cache_read_input_tokens: 42_000,
          cache_creation_input_tokens: 1_200,
        },
      },
    },
    160,
    { cache: { last_read: 109_300, last_input: 109_300, last_created: 0, caching_observed: true } },
  );
  assert.equal(stableRead.segs[0].fields.hit, '88');
  assert.equal(stableRead.segs[0].fields.read, '109.3k');
  assert.match(stableRead.text, /88% hit · 109\.3k read/);
  assert.doesNotMatch(stableRead.text, /50% hit|42k/);

  // A payload that only says the cache is warm must not replace the session ratio
  // with the last call's own 50% ratio, or rebuild rewarm from the window snapshot.
  const partialPayload = renderCache(
    {
      preset: 'author',
      segments: ['cache'],
      items: { cache: { format: '[{left}][ · {hit}% hit][ · {read} read][ · rewarm {rewarm}]' } },
    },
    {
      model: { id: 'gemini-4-neon', display_name: 'Gemini 4 Neon' },
      prompt_cache: { warm: true, expires_at: 1_790_813_022, ttl: '5m' },
      context_window: {
        current_usage: {
          input_tokens: 8_000,
          cache_read_input_tokens: 42_000,
          cache_creation_input_tokens: 200_000,
        },
      },
    },
    160,
    {
      cache: {
        hit_ratio: 0.88,
        requests: 41,
        last_read: 109_300,
        caching_observed: true,
        rewarm_usd: 0.33,
      },
    },
  );
  assert.equal(partialPayload.segs[0].fields.hit, '88');
  assert.equal(partialPayload.segs[0].fields.read, '109.3k');
  assert.equal(partialPayload.segs[0].fields.rewarm, '$0.33');
  assert.match(partialPayload.text, /88% hit · 109\.3k read · rewarm \$0\.33/);
  assert.doesNotMatch(partialPayload.text, /50%|42k/);

  // warm:true alone must not blank the SQLite countdown or miss count.
  // warm:false stays authoritative even when SQLite still has time left.
  const warmOnly = renderCache(
    {
      preset: 'cache-aware',
      segments: ['cache'],
    },
    { prompt_cache: { warm: true } },
    160,
    {
      cache: {
        warm: true,
        caching_observed: true,
        ttl: '5m',
        expires_at: 1_790_813_022,
        requests: 41,
        misses: 3,
        hit_ratio: 0.88,
        last_read: 109_300,
        last_created: 1_200,
        last_miss_cause: { causes: ['tools_changed'] },
      },
    },
  );
  const warmOnlyCache = warmOnly.segs.find((segment) => segment.id === 'cache');
  assert.equal(warmOnlyCache.fields.left, '3:42');
  assert.equal(warmOnlyCache.fields.hit, '88');
  assert.equal(warmOnlyCache.fields.misses, '3');
  assert.equal(warmOnlyCache.fields.read, '109.3k');
  assert.equal(warmOnlyCache.fields.created, '1.2k');
  assert.match(warmOnly.text, /3:42/);
  assert.match(warmOnly.text, /88% hit · 3× miss · last: tools changed/);
  assert.doesNotMatch(warmOnly.text, /cold/);

  // A record with only last_created still renders, and does not borrow the window snapshot.
  const createdOnly = renderCache(
    {
      preset: 'author',
      segments: ['cache'],
      items: { cache: { format: 'cache {read} read[ · {created} created]' } },
    },
    {
      prompt_cache: { last_created: 1_200 },
      context_window: { current_usage: { cache_read_input_tokens: 42_000, cache_creation_input_tokens: 9_000 } },
    },
  );
  assert.equal(createdOnly.segs[0].fields.read, null);
  assert.equal(createdOnly.segs[0].fields.created, '1.2k');
  assert.match(createdOnly.text, /cache 1\.2k created/);
  assert.doesNotMatch(createdOnly.text, /42k|9k/);

  // A live payload countdown wins over an already-expired SQLite expires_at.
  const freshCountdown = renderCache(
    {
      preset: 'cometix',
      segments: ['cache'],
      items: { cache: { format: '[{left}][{cold}][ · {hit}% hit]' } },
    },
    { prompt_cache: { expires_in_seconds: 280 } },
    160,
    { cache: { warm: false, expires_at: 1, ttl: '5m', hit_ratio: 0.88, requests: 4, last_read: 109_300 } },
  );
  assert.equal(freshCountdown.segs[0].fields.left, '4:40');
  assert.equal(freshCountdown.segs[0].fields.state, 'warm');
  assert.match(freshCountdown.text, /4:40 · 88% hit/);

  // SQLite can contradict itself: warm:false plus a future expires_at stays cold
  // when the payload says nothing about either field. An unparseable payload
  // expiry does not hide that SQLite countdown.
  const sqliteCold = renderCache(
    { preset: 'cometix', segments: ['cache'] },
    { prompt_cache: { expires_at: 'soon', hit_ratio: 0.5, requests: 2 } },
    160,
    { cache: { warm: false, expires_at: 1_790_813_022, ttl: '5m', hit_ratio: 0.88, requests: 4 } },
  );
  assert.equal(sqliteCold.segs[0].fields.state, 'cold');
  assert.match(sqliteCold.text, /cold · 50% hit/);

  const sqliteCountdown = renderCache(
    { preset: 'cometix', segments: ['cache'] },
    { prompt_cache: { expires_at: 'soon', hit_ratio: 0.5, requests: 2 } },
    160,
    { cache: { warm: true, expires_at: 1_790_813_022, ttl: '5m', hit_ratio: 0.88, requests: 4 } },
  );
  assert.equal(sqliteCountdown.segs[0].fields.left, '3:42');
  assert.equal(sqliteCountdown.segs[0].fields.state, 'warm');
  assert.match(sqliteCountdown.text, /3:42 · 50% hit/);

  const forcedCold = renderCache(
    { preset: 'cometix', segments: ['cache'] },
    { prompt_cache: { warm: false } },
    160,
    { cache: { warm: true, expires_at: 1_790_813_022, ttl: '5m', hit_ratio: 0.88, requests: 4 } },
  );
  assert.equal(forcedCold.segs[0].fields.state, 'cold');
  assert.match(forcedCold.text, /cold · 88% hit/);

  // An explicit payload opt-out stays hidden even when SQLite observed caching.
  const hidden = renderCache(
    { preset: 'cometix', segments: ['cache'] },
    { prompt_cache: { caching_observed: false, warm: true } },
    160,
    { cache: { caching_observed: true, hit_ratio: 0.88, requests: 4, last_read: 109_300 } },
  );
  assert.equal(hidden.segs.length, 0);

  // Without a last call, {read} still falls back to the context-window snapshot.
  const snapshotRead = renderCache(
    {
      preset: 'author',
      segments: ['cache'],
      items: { cache: { format: '{hit}% hit[ · {read} read]' } },
    },
    {
      context_window: {
        current_usage: {
          input_tokens: 63_382,
          cache_read_input_tokens: 20_857,
          cache_creation_input_tokens: 0,
        },
      },
    },
  );
  assert.equal(snapshotRead.segs[0].fields.hit, '25');
  assert.equal(snapshotRead.segs[0].fields.read, '20.9k');

  // cache-aware preset keeps 1-to-1 layout counts with unique segments
  const awarePrefs = normalizePreferences({ preset: 'cache-aware' });
  const totalSlots = presetRows(awarePrefs).reduce((sum, row) => sum + row.left.length + row.right.length, 0);
  assert.equal(totalSlots, awarePrefs.segments.length);
  const asciiAware = renderCache({ preset: 'cache-aware', icons: 'ascii' }, warmPayload).text;
  assert.match(asciiAware, /^[\x20-\x7e\n]+$/);
});

test('cache hit-only format presets render hit percentage cleanly across warm/cold states, widgets, and first-turn hits', () => {
  assert.equal(ITEM_FORMAT_PRESETS.cache[0], '[{left}][{cold}][ · {hit}% hit]');
  assert.ok(ITEM_FORMAT_PRESETS.cache.includes('{hit}% hit'));
  assert.ok(ITEM_FORMAT_PRESETS.cache.includes('{hit}%'));

  const baseNow = 1_790_812_800_000;
  const warmPayload = {
    prompt_cache: {
      warm: true,
      caching_observed: true,
      ttl: '5m',
      expires_at: 1_790_813_022,
      requests: 12,
      misses: 1,
      hit_ratio: 0.81,
    },
  };
  const coldPayload = {
    prompt_cache: {
      warm: false,
      caching_observed: true,
      ttl: '5m',
      expires_at: null,
      requests: 12,
      misses: 2,
      hit_ratio: 0.81,
    },
  };

  const renderRaw = (options, payload) => {
    const prefs = normalizePreferences(options);
    const segs = collectSegments(payload, prefs, null, { now: baseNow });
    return renderLine(segs, prefs, { width: 120, color: options.colorDepth !== 'none', env: {} });
  };

  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', segments: ['cache'], items: { cache: { format: '{hit}% hit' } } }, warmPayload)),
    '\uf1c0 81% hit',
  );
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', segments: ['cache'], items: { cache: { format: '{hit}%' } } }, warmPayload)),
    '\uf1c0 81%',
  );
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', icons: 'none', segments: ['cache'], items: { cache: { format: '{hit}% hit' } } }, warmPayload)),
    '81% hit',
  );
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', icons: 'none', segments: ['cache'], items: { cache: { format: '{hit}%' } } }, warmPayload)),
    '81%',
  );

  // Cold cache with hit-only format keeps normal cache color (catppuccin-mocha cache #89dceb, not warn #f9e2af)
  const coldHitOnly = renderRaw(
    { preset: 'cometix', theme: 'catppuccin-mocha', colorDepth: 'truecolor', segments: ['cache'], items: { cache: { format: '{hit}% hit' } } },
    coldPayload,
  );
  assert.equal(stripAnsi(coldHitOnly), '\uf1c0 81% hit');
  assert.match(coldHitOnly, /38;2;137;220;235m81% hit/);
  assert.doesNotMatch(coldHitOnly, /38;2;249;226;175m/);

  // Cold cache with hit-only format + gauge/bar reflects hit% (81%) rather than TTL remaining (0%)
  const coldGaugeNerd = renderRaw(
    { preset: 'cometix', theme: 'catppuccin-mocha', colorDepth: 'truecolor', segments: ['cache'], items: { cache: { widget: 'gauge', format: '{hit}%' } } },
    coldPayload,
  );
  assert.equal(stripAnsi(coldGaugeNerd), '\u{f0aa3} 81%');
  assert.match(coldGaugeNerd, /38;2;137;220;235m/);

  const coldGaugeUnicode = stripAnsi(renderRaw(
    { preset: 'cometix', icons: 'unicode', segments: ['cache'], items: { cache: { widget: 'gauge', format: '{hit}%' } } },
    coldPayload,
  ));
  assert.equal(coldGaugeUnicode, '◕ 81%');

  const coldBar = stripAnsi(renderRaw(
    { preset: 'cometix', segments: ['cache'], items: { cache: { widget: 'bar', format: '{hit}% hit' } } },
    coldPayload,
  ));
  assert.equal(coldBar, '\uf1c0 ▰▰▰▰▰▰▱▱ 81% hit');

  // First-request positive cache hit renders hit-only styles, while requests=1 & hit_ratio=0.0 keeps hiding 0% hit
  const firstTurnHit = {
    prompt_cache: { warm: true, caching_observed: true, ttl: '5m', expires_at: 1_790_813_060, requests: 1, hit_ratio: 0.81 },
  };
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', icons: 'none', segments: ['cache'], items: { cache: { format: '{hit}% hit' } } }, firstTurnHit)),
    '81% hit',
  );
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', icons: 'none', segments: ['cache'], items: { cache: { format: '{hit}%' } } }, firstTurnHit)),
    '81%',
  );

  const firstTurnZero = {
    prompt_cache: { warm: true, caching_observed: true, ttl: '5m', expires_at: 1_790_813_060, requests: 1, hit_ratio: 0.0 },
  };
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', icons: 'none', segments: ['cache'] }, firstTurnZero)),
    '4:20',
  );
  assert.equal(
    stripAnsi(renderRaw({ preset: 'cometix', icons: 'none', segments: ['cache'], items: { cache: { format: '{hit}%' } } }, firstTurnZero)),
    '4:20',
  );
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

test('quota 5h and 7d pace indicators color red when ahead, green when behind, and muted when on pace', () => {
  // 5h: 30% used, 25% elapsed -> ⇡5% (bad / crit); 7d: 20% used, 73% elapsed -> ⇣53% (good / ok)
  const aheadBehind = {
    quota: [
      { id: 'gemini-5h', label: '5h', remaining_fraction: 0.70, reset_in_seconds: 13_500 },
      { id: 'gemini-weekly', label: 'weekly', remaining_fraction: 0.80, reset_in_seconds: 163_296 },
    ],
  };
  // tokyo-night truecolor: crit = #f7768e (247;118;142), ok = #9ece6a (158;206;106), muted = #565f89 (86;95;137)
  const budget = render({ preset: 'budget', colorDepth: 'truecolor' }, aheadBehind, 160);
  assert.match(budget, /\x1b\[38;2;247;118;142m⇡5%\x1b\[0m/);
  assert.match(budget, /\x1b\[38;2;158;206;106m⇣53%\x1b\[0m/);
  // Quota text itself stays in quota color (#ff9e64 -> 255;158;100), separate from pace indicator color
  assert.match(budget, /\x1b\[38;2;255;158;100m5h 30% \x1b\[0m\x1b\[38;2;247;118;142m⇡5%\x1b\[0m/);

  // On pace (30% used, 30% elapsed -> ±0%) uses muted color
  const onPace = {
    quota: [
      { id: 'gemini-5h', label: '5h', remaining_fraction: 0.70, reset_in_seconds: 12_600 },
    ],
  };
  const onPaceBudget = render({ preset: 'budget', colorDepth: 'truecolor' }, onPace, 160);
  assert.match(onPaceBudget, /\x1b\[38;2;86;95;137m±0%\x1b\[0m/);

  // Terminal 16-color palette (cometix flat): crit = 16:1 (31), ok = 16:2 (32), muted = 16:8 (90)
  const terminal = render({ preset: 'cometix', layout: 'flat', segments: ['quota.5h', 'quota.7d'], colorDepth: '16' }, aheadBehind, 160);
  assert.match(terminal, /\x1b\[31m⇡5%\x1b\[0m/);
  assert.match(terminal, /\x1b\[32m⇣53%\x1b\[0m/);
  const terminalEven = render({ preset: 'cometix', layout: 'flat', segments: ['quota.5h'], colorDepth: '16' }, onPace, 160);
  assert.match(terminalEven, /\x1b\[90m±0%\x1b\[0m/);

  // Custom {pace} template also inherits pace coloring
  const signedPace = render(
    { preset: 'budget', colorDepth: 'truecolor', items: { 'quota.5h': { format: '5h {pct}% {pace}' }, 'quota.7d': { format: '7d {pct}% {pace}' } } },
    aheadBehind,
    160,
  );
  assert.match(signedPace, /\x1b\[38;2;247;118;142m\+5%\x1b\[0m/);
  assert.match(signedPace, /\x1b\[38;2;158;206;106m-53%\x1b\[0m/);

  // Dark filled powerline segment keeps high-contrast red/green on #24283b (36;40;59)
  const powerline = render({ preset: 'powerline', quotaPace: 'show', colorDepth: 'truecolor' }, aheadBehind, 160);
  assert.match(powerline, /\x1b\[38;2;247;118;142;48;2;36;40;59m⇡5%\x1b\[0m/);

  // Bright solid pill (catppuccin-mocha quota #fab387 -> 250;179;135) keeps readable dark ink (#111111 -> 17;17;17)
  const dashboard = render({ preset: 'dashboard', colorDepth: 'truecolor' }, aheadBehind, 160);
  assert.match(dashboard, /\x1b\[38;2;17;17;17;48;2;250;179;135m⇡5%\x1b\[0m/);
});

test('subagents segment renders agy-zh-pack aligned tree, prunes empty columns, caps at 4 rows, colors states, and supports inline widget', () => {
  // 1. Bare payload.subagents (name, role, status only) prunes empty model/ctx/cache/cost columns cleanly
  const barePayload = {
    model: { display_name: 'Gemini 4 Neon' },
    subagents: [
      { name: 'research', role: 'Paper Reviewer', status: 'running' },
      { name: 'self', role: 'self', status: 'waiting' }, // role === name is deduplicated
      { name: 'explore', role: 'Done Task', status: 'completed' },
    ],
  };
  const bareAnsi = render({ preset: 'cometix', segments: ['model', 'subagents'], colorDepth: 'truecolor', theme: 'catppuccin-mocha' }, barePayload, 140);
  const bareLines = bareAnsi.split('\n');
  assert.equal(bareLines.length, 4); // 1 main row + 3 subagent rows
  const plainBare = bareLines.slice(1).map(stripAnsi);
  assert.match(plainBare[0], /^ ├ \u{f04aa} research · Paper Reviewer \| ● running$/u);
  assert.match(plainBare[1], /^ ├ \u{f04aa} self\s+\| ● waiting$/u);
  assert.doesNotMatch(plainBare[1], /self · self/);
  assert.match(plainBare[2], /^ └ \u{f04aa} explore · Done Task\s+\| ✓ done$/u);
  // Column alignment: all '|' separators sit at the exact same visible column!
  const sepCols = plainBare.map((line) => visibleWidth(line.slice(0, line.indexOf('|'))));
  assert.equal(sepCols[0], sepCols[1]);
  assert.equal(sepCols[1], sepCols[2]);
  // Status colors in catppuccin-mocha: running -> ok (#a6e3a1 = 166;227;161), waiting -> warn (#f9e2af = 249;226;175), done -> muted (#6c7086 = 108;112;134)
  assert.match(bareLines[1], /38;2;166;227;161mrunning/);
  assert.match(bareLines[2], /38;2;249;226;175mwaiting/);
  assert.match(bareLines[3], /38;2;108;112;134mdone/);

  // 2. Cap at MAX_SUBS = 4 rows with overflow line, sorting active subagents before finished ones, and skipping PLACEHOLDER models
  const manyPayload = {
    subagents: [
      { name: 'done1', role: 'Finished First', status: 'completed', duration_ms: 12_000, steps: 3 },
      { name: 'run1', role: 'Active One', model: 'PLACEHOLDER_M530', status: 'running', duration_ms: 45_000 },
      { name: 'run2', role: 'Active Two', model: 'Gemini 4 Neon', status: 'running', duration_ms: 95_000 },
      { name: 'wait1', role: 'Needs Approval', status: 'waiting' },
      { name: 'done2', role: 'Finished Second', status: 'completed', duration_ms: 20_000, steps: 5 },
      { name: 'done3', role: 'Finished Third', status: 'completed', duration_ms: 30_000, steps: 7 },
    ],
  };
  const manyLines = stripAnsi(render({ preset: 'cometix', segments: ['subagents'] }, manyPayload, 160)).split('\n');
  assert.equal(manyLines.length, 5); // 4 subagents + overflow line
  assert.match(manyLines[0], /^ ├ .*run1 · Active One/);
  assert.doesNotMatch(manyLines[0], /PLACEHOLDER_M530/);
  assert.match(manyLines[1], /^ ├ .*run2 · Active Two.*Gemini 4 Neon.*● 1m35s/);
  assert.match(manyLines[2], /^ ├ .*wait1 · Needs Approval.*● waiting/);
  assert.match(manyLines[3], /^ ├ .*done1 · Finished First.*✓ done 12s · 3 steps/);
  assert.match(manyLines[4], /^ └ \+2 more subagents$/);

  // 3. Inline widget renders compact summary on the main row with custom format support
  const inline = stripAnsi(render(
    {
      preset: 'cometix',
      segments: ['model', 'subagents'],
      items: { subagents: { widget: 'inline', format: '{total} subagents · {cost}' } },
    },
    samplePayload(),
    140,
  ));
  assert.equal(inline.split('\n').length, 1);
  assert.match(inline, /\u{f04aa} 2 subagents · \$0\.48$/u);

  // 4. Empty/missing subagents renders zero extra lines
  const noSubs = stripAnsi(render({ preset: 'studio' }, { model: { display_name: 'Model' } }, 120));
  assert.equal(noSubs.split('\n').length, 1);

  // 5. ASCII mode stays strictly ASCII and avoids duplicate '$$' in unicode mode
  const asciiTree = stripAnsi(render({ preset: 'cometix', icons: 'ascii', segments: ['subagents'] }, samplePayload(), 160));
  assert.match(asciiTree, /^[\x20-\x7e\n]+$/);
  assert.match(asciiTree, /\|- research \/ Codebase Reviewer.*\* 1m05s/);
  assert.match(asciiTree, /\\- explore \/ Dependency Audit.*ok done 1m40s \/ 9 steps/);

  const studioTree = stripAnsi(render({ preset: 'studio' }, samplePayload(), 160));
  assert.doesNotMatch(studioTree, /\$\s+\$/);
});

test('custom multi-row layout works across built-in and upstream presets and validates layout helpers', () => {
  // Built-in presets support custom multi-row + left/right layouts
  const studioTwoRow = normalizePreferences({
    preset: 'studio',
    segments: ['model', 'dir', 'git', 'context', 'cost', 'state'],
    layout: [[3, 0], [3, 0]],
  });
  assert.deepEqual(studioTwoRow.layout, [[3, 0], [3, 0]]);
  assert.equal(layoutModeOf(studioTwoRow), 'custom');
  assert.deepEqual(presetRows(studioTwoRow).map(r => r.left.map(i => i.metric)), [
    ['model', 'dir', 'git'],
    ['context', 'cost', 'state'],
  ]);
  const studioOut = stripAnsi(render(studioTwoRow, samplePayload(), 160)).split('\n');
  assert.equal(studioOut.length, 2);
  assert.match(studioOut[0], /Gemini 4 Neon XHigh.*atlas.*main/);
  assert.match(studioOut[1], /42%.*\$1\.284.*editing/);

  const signalSplit = normalizePreferences({
    preset: 'signal',
    segments: ['model', 'dir', 'git', 'cost', 'context', 'quota', 'state', 'sandbox'],
    layout: [[3, 1], [4, 0]],
  });
  assert.deepEqual(presetRows(signalSplit)[0].right.map(i => i.metric), ['cost']);
  assert.equal(stripAnsi(render(signalSplit, samplePayload(), 160)).split('\n').length, 2);

  for (const preset of ['compact', 'bracket', 'focus-legacy']) {
    const prefs = normalizePreferences({ preset, segments: ['model', 'dir', 'git', 'context'], layout: [[2, 0], [2, 0]] });
    assert.equal(presetRows(prefs).length, 2);
  }

  // 'auto' normalizes to 'flat', and 'preset' on built-in presets normalizes to 'flat'
  assert.equal(normalizePreferences({ preset: 'dashboard', layout: 'auto' }).layout, 'flat');
  assert.equal(normalizePreferences({ preset: 'studio', layout: 'preset' }).layout, 'flat');
  assert.throws(() => normalizePreferences({ preset: 'studio', segments: ['model', 'dir', 'git', 'context'], layout: [[3, 0], [3, 0]] }), /layout counts/);
  assert.throws(() => normalizePreferences({ preset: 'studio', layout: 'grid' }), /unknown layout/);

  // Structured preset detection & seedCustomLayout
  for (const id of ['dashboard', 'budget', 'cache-aware', 'focus', 'powerline']) {
    assert.equal(presetHasStructuredLayout(id), true, id);
  }
  for (const id of ['cometix', 'minimal', 'zen', 'studio', 'signal', 'compact', 'bracket', 'focus-legacy']) {
    assert.equal(presetHasStructuredLayout(id), false, id);
  }
  assert.deepEqual(seedCustomLayout(normalizePreferences({ preset: 'studio', segments: ['model', 'dir', 'git', 'context', 'cost'] })), [[3, 0], [2, 0]]);
  assert.deepEqual(seedCustomLayout(normalizePreferences({ preset: 'studio', segments: ['model'] })), [[1, 0]]);
  assert.deepEqual(seedCustomLayout(normalizePreferences({ preset: 'budget' })), [[3, 2], [2, 0]]);

  // parseLayoutFlag
  assert.equal(parseLayoutFlag('flat'), 'flat');
  assert.equal(parseLayoutFlag('auto'), 'flat');
  assert.equal(parseLayoutFlag('preset'), 'preset');
  assert.deepEqual(parseLayoutFlag('3,2'), [[3, 0], [2, 0]]);
  assert.deepEqual(parseLayoutFlag('3:1, 2:1'), [[3, 1], [2, 1]]);
  for (const bad of ['', '0', '0:0', '3,,2', 'grid', '3:-1']) {
    assert.throws(() => parseLayoutFlag(bad), /unknown layout/);
  }

  // parseSegmentsAndLayout
  assert.deepEqual(parseSegmentsAndLayout('model,dir,git'), { segments: ['model', 'dir', 'git'], layout: undefined });
  assert.deepEqual(parseSegmentsAndLayout('model,dir,git / context,cache,cost'), {
    segments: ['model', 'dir', 'git', 'context', 'cache', 'cost'],
    layout: [[3, 0], [3, 0]],
  });
  assert.deepEqual(parseSegmentsAndLayout('model,dir | cost / context,cache'), {
    segments: ['model', 'dir', 'cost', 'context', 'cache'],
    layout: [[2, 1], [2, 0]],
  });
  assert.deepEqual(parseSegmentsAndLayout(' | cost'), { segments: ['cost'], layout: [[0, 1]] });
  assert.deepEqual(parseSegmentsAndLayout('model,dir / model,cost'), {
    segments: ['model', 'dir', 'cost'],
    layout: [[2, 0], [1, 0]],
  });
  assert.throws(() => parseSegmentsAndLayout('model / '), /empty row/);
  assert.throws(() => parseSegmentsAndLayout('model / model'), /empty row/);
  assert.throws(() => parseSegmentsAndLayout('model | dir | cost'), /at most one '\|'/);
  assert.throws(() => parseSegmentsAndLayout('model / nope'), /unknown segment/);
});

test('context segment includes prompt cache read and creation tokens in used tokens, remaining tokens, and fallback percent', () => {
  const cachedPayload = {
    context_window: {
      used_percentage: 41,
      current_usage: {
        input_tokens: 5_313,
        output_tokens: 1_635,
        cache_read_input_tokens: 426_551,
        cache_creation_input_tokens: 0,
      },
      context_window_size: 1_048_576,
    },
  };
  const ratioPrefs = normalizePreferences({
    preset: 'cometix',
    icons: 'none',
    segments: ['context'],
    items: { context: { widget: 'text', format: '{pct}% · {tokens}/{window} · {left} left' } },
  });
  const ratioOut = stripAnsi(renderLine(collectSegments(cachedPayload, ratioPrefs), ratioPrefs, { width: 120, env: {} }));
  assert.equal(ratioOut, '41% · 433.5k/1M · 615.1k left');

  // When used_percentage is omitted, fallback percentage also sums cache_read + cache_creation + input + output
  const fallbackPayload = {
    context_window: {
      current_usage: {
        input_tokens: 5_000,
        output_tokens: 2_000,
        cache_read_input_tokens: 393_000,
        cache_creation_input_tokens: 10_000,
      },
      context_window_size: 1_000_000,
    },
  };
  const fallbackOut = stripAnsi(renderLine(collectSegments(fallbackPayload, ratioPrefs), ratioPrefs, { width: 120, env: {} }));
  assert.equal(fallbackOut, '41% · 410k/1M · 590k left');

  // Cache-read-only current_usage still reports tokens
  const readOnlyPayload = {
    context_window: {
      current_usage: { cache_read_input_tokens: 50_000 },
      context_window_size: 200_000,
    },
  };
  const readOnlyOut = stripAnsi(renderLine(collectSegments(readOnlyPayload, ratioPrefs), ratioPrefs, { width: 120, env: {} }));
  assert.equal(readOnlyOut, '25% · 50k/200k · 150k left');
});

test('context percentage prefers current_usage ratio over used_percentage and keeps cumulative totals as fallback only', () => {
  const ratioPrefs = normalizePreferences({
    preset: 'cometix',
    icons: 'none',
    segments: ['context'],
    items: { context: { widget: 'text', format: '{pct}%[ · {tokens}[/{window}]][ · {left} left]' } },
  });

  // Divergent used_percentage (6.14% client estimate) vs actual current_usage (51,322 / 1,048,576 = 4.89% -> 5%)
  const divergentPayload = {
    context_window: {
      used_percentage: 6.14,
      current_usage: {
        input_tokens: 2_286,
        output_tokens: 1_144,
        cache_read_input_tokens: 47_892,
        cache_creation_input_tokens: 0,
      },
      context_window_size: 1_048_576,
    },
  };
  const divergentOut = stripAnsi(renderLine(collectSegments(divergentPayload, ratioPrefs), ratioPrefs, { width: 120, env: {} }));
  assert.equal(divergentOut, '5% · 51.3k/1M · 997.3k left');

  // When current_usage is absent, keep agy's used_percentage instead of cumulative totals
  const cumulativeOnlyPayload = {
    context_window: {
      used_percentage: 6.14,
      total_input_tokens: 800_000,
      total_output_tokens: 50_000,
      context_window_size: 1_048_576,
    },
  };
  const cumulativeOut = stripAnsi(renderLine(collectSegments(cumulativeOnlyPayload, ratioPrefs), ratioPrefs, { width: 120, env: {} }));
  assert.equal(cumulativeOut, '6% · 850k/1M · 198.6k left');

  // When current_usage is present but context_window_size is omitted, fall back to used_percentage
  const noSizePayload = {
    context_window: {
      used_percentage: 68,
      current_usage: { input_tokens: 340_000 },
    },
  };
  const noSizeOut = stripAnsi(renderLine(collectSegments(noSizePayload, ratioPrefs), ratioPrefs, { width: 120, env: {} }));
  assert.equal(noSizeOut, '68% · 340k');
});

test('model format presets render regular models, Orchestrator Planner/Executor states, unknown fallbacks, and ASCII arrows', () => {
  const renderModel = (payload, format, extra = {}) => {
    const prefs = normalizePreferences({
      preset: 'cometix',
      icons: 'none',
      segments: ['model'],
      ...(format != null ? { items: { model: { format } } } : {}),
      ...extra,
    });
    return stripAnsi(renderLine(collectSegments(payload, prefs), prefs, { width: 120, env: {} }));
  };

  const regular = { model: { id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', effort: 'high' } };
  const planner = orchestratorSamplePayload('planner');
  const executor = orchestratorSamplePayload('executor');
  const unknownExec = {
    model: { id: 'orchestrator-neon', display_name: 'Orchestrator (Neon)' },
    orchestrator: { phase: 'executor', activeModel: '', activeId: '', plannerModel: 'Gemini 4 Neon (XHigh)', executorModel: '' },
  };

  const expectedRegular = [
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro high',
    'Gemini 2.5 Pro',
    'Gemini',
    'gemini-2.5-pro',
  ];
  const expectedPlanner = [
    'Orchestrator (Neon)',
    'Orchestrator (Neon)',
    'Planner (Neon)',
    'Planner · Gemini 4 Neon (XHigh)',
    'Plan: Gemini 4 Neon (XHigh)',
    'Gemini 4 Neon (XHigh) (Plan)',
    'Gemini 4 Neon (XHigh)',
    'Orchestrator (Neon)',
    'Orchestrator (Neon)',
    'Orchestrator',
    'orchestrator-neon',
  ];
  const expectedExecutor = [
    'Executor (Hydrogen)',
    'Orchestrator (Neon) → Hydrogen',
    'Executor (Hydrogen)',
    'Executor · Gemini 4 Hydrogen (XHigh)',
    'Exec: Gemini 4 Hydrogen (XHigh)',
    'Gemini 4 Hydrogen (XHigh) (Exec)',
    'Gemini 4 Hydrogen (XHigh)',
    'Orchestrator (Neon)',
    'Executor (Hydrogen)',
    'Orchestrator',
    'gemini-4-hydrogen',
  ];

  assert.equal(ITEM_FORMAT_PRESETS.model.length, expectedRegular.length);
  ITEM_FORMAT_PRESETS.model.forEach((fmt, idx) => {
    assert.equal(renderModel(regular, fmt), expectedRegular[idx], `regular[${idx}]: ${fmt}`);
    assert.equal(renderModel(planner, fmt), expectedPlanner[idx], `planner[${idx}]: ${fmt}`);
    assert.equal(renderModel(executor, fmt), expectedExecutor[idx], `executor[${idx}]: ${fmt}`);
  });

  // Unknown executor model falls back cleanly to Executor without stale Planner model
  assert.equal(renderModel(unknownExec, ITEM_FORMAT_PRESETS.model[0]), 'Executor');
  assert.equal(renderModel(unknownExec, ITEM_FORMAT_PRESETS.model[1]), 'Orchestrator (Neon) → Executor');

  // ASCII mode converts → to ->
  const asciiOut = renderModel(executor, ITEM_FORMAT_PRESETS.model[1], { icons: 'ascii' });
  assert.equal(asciiOut, 'Orchestrator (Neon) -> Hydrogen');
  assert.match(asciiOut, /^[\x20-\x7e]+$/);

  // Orchestrator payload effort is suppressed when active model already ends with effort level
  const withEffort = {
    model: { id: 'orchestrator-neon', display_name: 'Orchestrator (Neon)', effort: 'xhigh' },
    orchestrator: executor.orchestrator,
  };
  assert.equal(renderModel(withEffort, '{name}[ {effort}]'), 'Executor (Hydrogen)');
});
