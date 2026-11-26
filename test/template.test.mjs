import assert from 'node:assert/strict';
import test from 'node:test';
import { stripAnsi } from '../lib/ansi.mjs';
import { normalizePreferences, PRESETS } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { SAMPLE_GIT, samplePayload } from '../lib/sample.mjs';
import { collectSegments } from '../lib/segments.mjs';
import { renderTemplate, renderTemplateParts, templateUsesField } from '../lib/template.mjs';

test('renderTemplate interpolates fields, drops incomplete groups, and handles escapes', () => {
  assert.equal(renderTemplate('{pct}%[ · {tokens} tokens]', { pct: '42', tokens: '84k' }), '42% · 84k tokens');
  assert.equal(renderTemplate('{pct}%[ · {tokens} tokens]', { pct: '42', tokens: null }), '42%');
  assert.equal(renderTemplate('{pct}%[ · {tokens}[/{window}]]', { pct: '68', tokens: '340k', window: '500k' }), '68% · 340k/500k');
  assert.equal(renderTemplate('{pct}%[ · {tokens}[/{window}]]', { pct: '68', tokens: '340k', window: null }), '68% · 340k');
  assert.equal(renderTemplate('{pct}%[ · {tokens}[/{window}]]', { pct: '68', tokens: null, window: '500k' }), '68%');
  assert.equal(renderTemplate('{pct}%[ · {a} {b}]', { pct: '10', a: '1', b: '' }), '10%');
  assert.equal(renderTemplate('{pct}%', { pct: null }), '');
  assert.equal(renderTemplate('[{a}][{b}]', { a: null, b: null }), '');
  assert.equal(renderTemplate('\\[{pct}\\]', { pct: '42' }), '[42]');
  assert.equal(renderTemplate('static', {}), 'static');
  assert.equal(templateUsesField('5h {pct}%[ {pace}]', ['pace', 'arrow']), true);
  assert.equal(templateUsesField('5h {pct}%[ · {left}]', ['pace', 'arrow']), false);
  assert.deepEqual(
    renderTemplateParts('5h {pct}%[ {arrow}][ · {left}]', { pct: '38', arrow: '⇡19%', left: '4h01m' }, { arrow: 'bad' }),
    [
      { text: '5h 38% ', role: 'text' },
      { text: '⇡19%', role: 'bad' },
      { text: ' · 4h01m', role: 'text' },
    ],
  );
});

test('changing a preset context or quota format string changes rendered text without special cases', () => {
  const cometixContext = PRESETS.cometix.rows[0].left.find(item => item.metric === 'context');
  const budget5h = PRESETS.budget.rows[0].left.find(item => item.metric === 'quota.5h');
  const budget7d = PRESETS.budget.rows[0].left.find(item => item.metric === 'quota.7d');
  const origContext = cometixContext.format;
  const orig5h = budget5h.format;
  const orig7d = budget7d.format;
  const fixedNow = new Date(2026, 9, 1, 10, 0, 0).getTime(); // 2026-10-01 10:00 local

  try {
    cometixContext.format = '{pct}% ({tokens}/{window}, {left} left)';
    const prefs = normalizePreferences({ preset: 'cometix' });
    const segments = collectSegments(samplePayload(), prefs, SAMPLE_GIT, { now: fixedNow });
    const rendered = stripAnsi(renderLine(segments, prefs, { width: 160, env: {} }));
    assert.match(rendered, /42% \(84k\/200k, 116k left\)/);

    // Optional group drops cleanly when window/left are missing
    cometixContext.format = '{pct}%[ · {tokens}][ · {left} left of {window}]';
    const partialPayload = { context_window: { used_percentage: 50, current_usage: { input_tokens: 10000 } } };
    const partialSegs = collectSegments(partialPayload, prefs, null, { now: fixedNow });
    const partialOut = stripAnsi(renderLine(partialSegs, prefs, { width: 120, env: {} }));
    assert.match(partialOut, /50% · 10k/);
    assert.doesNotMatch(partialOut, /left of/);

    // Global contextFormat override continues to work over preset format
    const ratioPrefs = normalizePreferences({ preset: 'cometix', contextFormat: 'ratio' });
    const ratioOut = stripAnsi(renderLine(collectSegments(samplePayload(), ratioPrefs, SAMPLE_GIT, { now: fixedNow }), ratioPrefs, { width: 160, env: {} }));
    assert.match(ratioOut, /42% · 84k\/200k/);

    // Quota 5h & 7d custom templates with pct, reset, left, pace, arrow
    budget5h.format = '5h {pct}%[ {pace}][ {arrow}][ ({left} -> {reset})]';
    budget7d.format = '7d {pct}%[ {left}][ at {reset}]';
    const budgetPrefs = normalizePreferences({ preset: 'budget' });
    const quotaSegs = collectSegments(samplePayload(), budgetPrefs, null, { now: fixedNow });
    const budgetOut = stripAnsi(renderLine(quotaSegs, budgetPrefs, { width: 160, env: {} }));
    assert.match(budgetOut, /5h 38% \+19% ⇡19% \(4h01m -> 14:01\)/);
    assert.match(budgetOut, /7d 82% 3d3h at Sun 13:00/);

    // quotaPace: hide suppresses pace and arrow even inside custom templates
    const hiddenPrefs = normalizePreferences({ preset: 'budget', quotaPace: 'hide' });
    const hiddenOut = stripAnsi(renderLine(collectSegments(samplePayload(), hiddenPrefs, null, { now: fixedNow }), hiddenPrefs, { width: 160, env: {} }));
    assert.match(hiddenOut, /5h 38% \(4h01m -> 14:01\)/);
    assert.doesNotMatch(hiddenOut, /\+19%|⇡19%/);

    // Missing reset_in_seconds drops reset/left/pace/arrow groups cleanly
    const noResetPayload = { quota: [{ id: 'gemini-5h', label: '5h', remaining_fraction: 0.7 }] };
    const noResetOut = stripAnsi(renderLine(collectSegments(noResetPayload, budgetPrefs, null, { now: fixedNow }), budgetPrefs, { width: 160, env: {} }));
    assert.match(noResetOut, /5h 30%/);
    assert.doesNotMatch(noResetOut, /->|⇡|\+/);
  } finally {
    cometixContext.format = origContext;
    budget5h.format = orig5h;
    budget7d.format = orig7d;
  }
});

test('normalizePreferences validates per-segment items overrides', () => {
  const valid = normalizePreferences({
    preset: 'dashboard',
    items: {
      context: { widget: 'gauge', icon: '', format: '{pct}% ({left})' },
      git: { format: '{branch} {sha}' },
    },
  });
  assert.deepEqual(valid.items, {
    context: { widget: 'gauge', icon: '', format: '{pct}% ({left})' },
    git: { format: '{branch} {sha}' },
  });
  assert.equal(normalizePreferences({ items: { git: { format: '   ' } } }).items, undefined);
  assert.throws(() => normalizePreferences({ items: [] }), /items must be an object/);
  assert.throws(() => normalizePreferences({ items: { unknown: { icon: '*' } } }), /unknown segment/);
  assert.throws(() => normalizePreferences({ items: { model: { widget: 'bar' } } }), /unknown widget/);
  assert.throws(() => normalizePreferences({ items: { git: { icon: 123 } } }), /must be a string/);
  assert.throws(() => normalizePreferences({ items: { git: { format: 123 } } }), /must be a string/);
});
