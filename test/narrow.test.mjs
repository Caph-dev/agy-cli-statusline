import assert from 'node:assert/strict';
import test from 'node:test';
import { stripAnsi, visibleWidth } from '../lib/ansi.mjs';
import { normalizePreferences } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { SAMPLE_GIT, SAMPLE_HOME, samplePayload } from '../lib/sample.mjs';
import { collectSegments } from '../lib/segments.mjs';

function renderAt(options, width, { color = false, payload = samplePayload(), git = SAMPLE_GIT } = {}) {
  const prefs = normalizePreferences(options);
  const segments = collectSegments(payload, prefs, git, { home: SAMPLE_HOME });
  return stripAnsi(renderLine(segments, prefs, { width, color, env: {} }));
}

test('narrow terminals wrap overflowing rows at full fidelity without degrading or dropping segments', () => {
  const full = renderAt({ preset: 'zen' }, 120);
  assert.equal(full, 'Gemini 4 Neon XHigh | ctx 42% | cache 3:42 | $1.284');

  for (const width of [50, 35]) {
    const wrapped = renderAt({ preset: 'zen' }, width);
    const lines = wrapped.split('\n');
    assert.ok(lines.length >= 2, wrapped);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
    assert.match(wrapped, /Gemini 4 Neon XHigh/);
    assert.match(wrapped, /ctx 42%/);
    assert.match(wrapped, /cache 3:42/);
    assert.match(wrapped, /\$1\.284/);
  }
});

test('multi-side rows wrap cleanly and keep full bars and labels instead of degrading', () => {
  // focus row 0: context (20-cell eighths bar) on left, model on right
  const wide = renderAt({ preset: 'focus' }, 100).split('\n')[0];
  assert.match(wide, /42% · 84k.*Gemini 4 Neon XHigh/);

  const wrapped = renderAt({ preset: 'focus' }, 40);
  const lines = wrapped.split('\n');
  assert.ok(lines.length >= 3, wrapped);
  for (const line of lines) assert.ok(visibleWidth(line) <= 40, line);
  assert.match(lines[0], /◔.*▏ 42% · 84k/);
  assert.match(lines[1], /^\s+◆ Gemini 4 Neon XHigh$/);
  assert.match(lines[2], /≈ 3:42 · 94% hit/);
});

test('wrapping preserves icons, bars, dir styles, git SHA, quota pace, and all segments for flat and legacy layouts', () => {
  // Legacy preset wraps without dropping segments or shortening text/bars
  const studio = renderAt(
    { preset: 'studio', skin: 'plain', icons: 'none', segments: ['dir', 'git', 'context', 'vcs'] },
    34,
  );
  const studioLines = studio.split('\n');
  assert.ok(studioLines.length >= 2, studio);
  for (const line of studioLines) assert.ok(visibleWidth(line) <= 34, line);
  assert.match(studio, /~\/…\/atlas/);
  assert.match(studio, /main \* \+1 2f08999/);
  assert.match(studio, /◑ 42%/);
  assert.match(studio, /\bgit\b/);

  // 9-segment flat cometix layout on a 66-column terminal keeps every icon, full text, and all 9 segments
  const nineSegments = ['model', 'context', 'cache', 'dir', 'git', 'worktree', 'quota.5h', 'quota.7d', 'cost'];
  const cometix = renderAt(
    { preset: 'cometix', layout: 'flat', segments: nineSegments },
    66,
    { color: true },
  );
  const cometixLines = cometix.split('\n');
  assert.ok(cometixLines.length >= 3, cometix);
  for (const line of cometixLines) assert.ok(visibleWidth(line) <= 66, line);
  assert.match(cometix, /\uef23 Gemini 4 Neon XHigh/);
  assert.match(cometix, /\u{f0aa0} 42% · 84k tokens/u);
  assert.doesNotMatch(cometix, /▰|▱/); // cometix uses dynamic ring gauge for context even when layout is flat
  assert.match(cometix, /\uf1c0 3:42 · 94% hit/);
  assert.match(cometix, /\u{f024b} ~\/…\/atlas/u);
  assert.match(cometix, /\u{f02a2} main \* ↑1 2f08999/u);
  assert.match(cometix, /\uf1bb atlas-feature/);
  assert.match(cometix, /\u{f0520} ▀▀▀▀▀▀▀▀ 5h 38% ⇡19% · 4h01m/u);
  assert.match(cometix, /\u{f0520} ▀▀▀▀▀▀▀▀ 7d 82% ⇡27% · 3d3h/u);
  assert.match(cometix, /\ueec1 \$1\.284/);

  // Quota row keeps pace deltas and reset countdowns when wrapping
  const quotaWrapped = renderAt({ preset: 'budget', icons: 'ascii', segments: ['quota.5h', 'quota.7d'] }, 30);
  const quotaLines = quotaWrapped.split('\n');
  assert.equal(quotaLines.length, 2);
  for (const line of quotaLines) assert.ok(visibleWidth(line) <= 30, line);
  assert.match(quotaWrapped, /5h 38% \+19% \/ 4h01m/);
  assert.match(quotaWrapped, /7d 82% \+27% \/ 3d3h/);

  // Subagent tree wraps cleanly across narrow widths without dropping columns or exceeding width
  for (const width of [60, 40, 12, 1]) {
    const wrapped = renderAt({ preset: 'cometix', segments: ['model', 'subagents'] }, width, { color: true });
    const lines = wrapped.split('\n');
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `subagents width=${width}: ${line}`);
    if (width >= 40) {
      assert.match(wrapped, /research · Codebase Reviewer/);
      assert.match(wrapped, /Gemini 4 Neon \(High\)/);
      assert.match(wrapped, /97% hit/);
      assert.match(wrapped, /\$0\.40/);
      assert.match(wrapped, /1m05s/);
      assert.match(wrapped, /done 1m40s · 9 steps/);
    }
  }
});

test('hybrid manual multi-row layout preserves row breaks while wrapping each overflowing row independently', () => {
  const twoRowStudio = {
    preset: 'studio',
    skin: 'plain',
    icons: 'none',
    segments: ['model', 'dir', 'git', 'context', 'cache', 'cost'],
    layout: [[3, 0], [3, 0]],
  };

  // Wide terminal strictly keeps 2 manual rows
  const wideLines = renderAt(twoRowStudio, 120).split('\n');
  assert.equal(wideLines.length, 2);
  assert.match(wideLines[0], /^Gemini 4 Neon XHigh · ~\/…\/atlas · main \* \+1 2f08999$/);
  assert.match(wideLines[1], /^◑ 42% · 3:42 · 94% hit · \$1\.284$/);

  // Narrow terminal (width 36) wraps Row 1 onto 2 lines AND starts Row 2 cleanly on its own new line
  const narrowLines = renderAt(twoRowStudio, 36).split('\n');
  assert.ok(narrowLines.length >= 3, narrowLines.join('\n'));
  for (const line of narrowLines) assert.ok(visibleWidth(line) <= 36, line);
  assert.equal(narrowLines[0], 'Gemini 4 Neon XHigh · ~/…/atlas');
  assert.equal(narrowLines[1], 'main * +1 2f08999');
  assert.match(narrowLines[2], /^◑ 42%/);

  // Empty logical row collapses without producing blank lines
  const collapsed = renderAt(
    { preset: 'studio', skin: 'plain', icons: 'none', segments: ['model', 'dir', 'quota.5h', 'cost'], layout: [[2, 0], [2, 0]] },
    100,
    { payload: { model: { display_name: 'Gemini' }, workspace: { current_dir: '/Users/ada/src/atlas' } }, git: null },
  );
  assert.equal(collapsed, 'Gemini · ~/…/atlas');

  // Custom left/right row on built-in preset right-aligns on wide terminal and wraps cleanly on narrow terminal
  const splitPrefs = {
    preset: 'studio',
    skin: 'plain',
    icons: 'none',
    segments: ['model', 'dir', 'cost', 'context', 'cache'],
    layout: [[2, 1], [2, 0]],
  };
  const splitWide = renderAt(splitPrefs, 100).split('\n');
  assert.equal(splitWide.length, 2);
  assert.equal(visibleWidth(splitWide[0]), 100);
  assert.match(splitWide[0], /^Gemini 4 Neon XHigh · ~\/…\/atlas\s+\$1\.284$/);
  assert.match(splitWide[1], /^◑ 42% · 3:42 · 94% hit$/);

  const splitNarrow = renderAt(splitPrefs, 30).split('\n');
  for (const line of splitNarrow) assert.ok(visibleWidth(line) <= 30, line);
  const costLineIndex = splitNarrow.findIndex(line => line.includes('$1.284'));
  const ctxLineIndex = splitNarrow.findIndex(line => line.includes('42%'));
  assert.ok(costLineIndex >= 0 && ctxLineIndex > costLineIndex);
  assert.match(splitNarrow[costLineIndex], /^\s+\$1\.284$/);
});
