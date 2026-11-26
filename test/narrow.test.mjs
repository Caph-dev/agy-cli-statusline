import assert from 'node:assert/strict';
import test from 'node:test';
import { stripAnsi, visibleWidth } from '../lib/ansi.mjs';
import { normalizePreferences } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { SAMPLE_GIT, samplePayload } from '../lib/sample.mjs';
import { collectSegments } from '../lib/segments.mjs';

function renderAt(options, width, payload = samplePayload(), git = SAMPLE_GIT) {
  const prefs = normalizePreferences(options);
  const segments = collectSegments(payload, prefs, git, { home: '/Users/ada' });
  return stripAnsi(renderLine(segments, prefs, { width, env: {} }));
}

test('narrow terminals step items from full to compact to minimal before dropping lowest priority first', () => {
  // zen row: model (p=5, compact={family}), context (p=5, ctx 42% -> 42%), cache (p=2), cost (p=4)
  const full = renderAt({ preset: 'zen' }, 120);
  assert.equal(full, 'Gemini 2.5 Pro high | ctx 42% | cache 42k read / 1.2k created | $1.284');

  // Step 1 (full -> compact): lowest priority (cache) shrinks first while higher priorities stay full
  const w50 = renderAt({ preset: 'zen' }, 50);
  assert.ok(visibleWidth(w50) <= 50, w50);
  assert.equal(w50, 'Gemini 2.5 Pro high | ctx 42% | 42k read | $1.284');

  // Tighter: context and model step down to compact (zen model compact = {family})
  const w35 = renderAt({ preset: 'zen' }, 35);
  assert.ok(visibleWidth(w35) <= 35, w35);
  assert.equal(w35, 'Gemini | 42% | 42k read | $1.284');

  // Step 2 (compact -> minimal): cache drops to minimal '42k' before anything is dropped
  const w28 = renderAt({ preset: 'zen' }, 28);
  assert.ok(visibleWidth(w28) <= 28, w28);
  assert.equal(w28, 'Gemini | 42% | 42k | $1.284');

  // Step 3 (drop lowest priority): cache (p=2) drops first while cost (p=4), context (p=5), model (p=5) remain
  const w22 = renderAt({ preset: 'zen' }, 22);
  assert.ok(visibleWidth(w22) <= 22, w22);
  assert.equal(w22, 'Gemini | 42% | $1.284');

  // Next drop: cost (p=4) drops before model/context (p=5)
  const w14 = renderAt({ preset: 'zen' }, 14);
  assert.ok(visibleWidth(w14) <= 14, w14);
  assert.equal(w14, 'Gemini | 42%');

  // Single remaining item fits without truncation when minimal fits, and truncates safely when narrower still
  const w8 = renderAt({ preset: 'zen' }, 8);
  assert.ok(visibleWidth(w8) <= 8, w8);
  assert.equal(w8, 'Gemini');
  const w4 = renderAt({ preset: 'zen' }, 4);
  assert.ok(visibleWidth(w4) <= 4, w4);
});

test('explicit item priority controls which segment drops first on a narrow row', () => {
  // focus row 0: context (bar 20 cells, priority=5) on left, model (priority=2) on right
  const wide = renderAt({ preset: 'focus' }, 100).split('\n')[0];
  assert.match(wide, /42% · 84k.*Gemini 2\.5 Pro high/);

  // Medium narrow: context drops its 20-cell bar (compact) and model drops effort, keeping both on one row
  const mid = renderAt({ preset: 'focus' }, 36).split('\n')[0];
  assert.ok(visibleWidth(mid) <= 36, mid);
  assert.match(mid, /42%.*Gemini/);

  // Very narrow: model (priority=2) drops before context (priority=5)
  const tight = renderAt({ preset: 'focus' }, 9).split('\n')[0];
  assert.ok(visibleWidth(tight) <= 9, tight);
  assert.match(tight, /42%/);
  assert.doesNotMatch(tight, /Gemini/);
});

test('git and quota rows shorten bars, SHA, and countdowns before dropping segments', () => {
  // Legacy preset with dir (p=4), git (p=4), context (p=5), vcs (p=1)
  const wide = renderAt({ preset: 'studio', skin: 'plain', icons: 'none', segments: ['dir', 'git', 'context', 'vcs'] }, 100);
  assert.match(wide, /~\/…\/atlas · main \* \+1 2f08999 · 42% ██░░░ · git/);

  // Medium: lower-priority git (drops SHA) and dir (drops to name) shrink first, keeping context's bar and vcs
  const w34 = renderAt({ preset: 'studio', skin: 'plain', icons: 'none', segments: ['dir', 'git', 'context', 'vcs'] }, 34);
  assert.equal(w34, 'atlas · main * · 42% ██░░░ · git');

  // Tighter: context drops its bar (compact) before vcs is dropped
  const mid = renderAt({ preset: 'studio', skin: 'plain', icons: 'none', segments: ['dir', 'git', 'context', 'vcs'] }, 28);
  assert.ok(visibleWidth(mid) <= 28, mid);
  assert.equal(mid, 'atlas · main * · 42% · git');

  // Narrower still: vcs (p=1) drops first while dir/git/context remain!
  const tight = renderAt({ preset: 'studio', skin: 'plain', icons: 'none', segments: ['dir', 'git', 'context', 'vcs'] }, 22);
  assert.ok(visibleWidth(tight) <= 22, tight);
  assert.equal(tight, 'atlas · main · 42%');

  // Quota row drops pace bar & countdown before dropping 7d or 5h
  const quotaMid = renderAt({ preset: 'budget', icons: 'ascii', segments: ['quota.5h', 'quota.7d'] }, 30);
  assert.ok(visibleWidth(quotaMid) <= 30, quotaMid);
  assert.match(quotaMid, /5h 38%/);
  assert.match(quotaMid, /7d 82%/);
  assert.doesNotMatch(quotaMid, /4h01m|3d3h/);

  // Explicit dirStyle=short keeps ~/s/atlas in compact before falling back to atlas in minimal
  const shortDir = renderAt({ preset: 'cometix', dirStyle: 'short' }, 80);
  assert.ok(visibleWidth(shortDir) <= 80, shortDir);
  assert.match(shortDir, /~\/s\/atlas/);
});
