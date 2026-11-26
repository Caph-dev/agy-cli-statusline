import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stripAnsi } from '../lib/ansi.mjs';
import { parsePorcelain, readGit } from '../lib/git.mjs';
import { normalizePreferences, PRESETS } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { collectSegments, formatDirPath } from '../lib/segments.mjs';

test('formatDirPath supports auto, name, parent, tilde, short, and full styles', () => {
  const home = '/Users/ada';
  const dir = '/Users/ada/src/atlas';
  assert.equal(formatDirPath(dir, 'auto', { home }), '~/…/atlas');
  assert.equal(formatDirPath(dir, 'name', { home }), 'atlas');
  assert.equal(formatDirPath(dir, 'parent', { home }), 'src/atlas');
  assert.equal(formatDirPath(dir, 'tilde', { home }), '~/src/atlas');
  assert.equal(formatDirPath(dir, 'short', { home }), '~/s/atlas');
  assert.equal(formatDirPath(dir, 'full', { home }), '/Users/ada/src/atlas');

  assert.equal(formatDirPath('/Users/ada/.config/nvim', 'short', { home }), '~/.c/nvim');
  assert.equal(formatDirPath('/var/log/nginx', 'short', { home }), '/v/l/nginx');
  assert.equal(formatDirPath('/Users/ada', 'tilde', { home }), '~');
  assert.equal(formatDirPath('/', 'name', { home }), '/');
  assert.equal(formatDirPath('/', 'parent', { home }), '/');

  const payload = { workspace: { current_dir: dir } };
  for (const [dirStyle, expected] of [
    ['auto', '~/…/atlas'],
    ['name', 'atlas'],
    ['parent', 'src/atlas'],
    ['tilde', '~/src/atlas'],
    ['short', '~/s/atlas'],
    ['full', '/Users/ada/src/atlas'],
  ]) {
    const prefs = normalizePreferences({ preset: 'cometix', dirStyle, segments: ['dir'] });
    const segments = collectSegments(payload, prefs, null, { home });
    assert.match(stripAnsi(renderLine(segments, prefs, { width: 120, env: {} })), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.throws(() => normalizePreferences({ dirStyle: 'invalid' }), /unknown directory style/);
});

test('parsePorcelain counts staged, modified, untracked, and conflict entries from status output', () => {
  const sample = [
    'M  staged.txt',
    ' M modified.txt',
    'MM both.txt',
    'A  added.txt',
    'R  old.txt -> new.txt',
    '?? untracked1.txt',
    '?? untracked2.txt',
    'UU conflict.txt',
    '!! ignored.txt',
  ].join('\n');
  assert.deepEqual(parsePorcelain(sample), {
    dirty: true,
    staged: 4,
    modified: 2,
    untracked: 2,
    conflicts: 1,
  });
  assert.deepEqual(parsePorcelain(''), {
    dirty: false,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
  });
});

test('readGit returns short HEAD SHA and porcelain counts without extra queries, and git renders SHA and counts', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'agy-git-test-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const runGit = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  runGit('init', '-b', 'main');
  runGit('config', 'user.email', 'test@example.com');
  runGit('config', 'user.name', 'Test User');

  // Unborn repo has empty sha
  const unborn = await readGit(repo);
  assert.equal(unborn.unborn, true);
  assert.equal(unborn.sha, '');

  // Commit one file
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  runGit('add', 'a.txt');
  runGit('commit', '-m', 'init');
  const expectedSha = runGit('rev-parse', 'HEAD').trim().slice(0, 7);

  // Stage one change, modify one tracked file, create one untracked file
  writeFileSync(join(repo, 'staged.txt'), 'staged\n');
  runGit('add', 'staged.txt');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  writeFileSync(join(repo, 'untracked.txt'), 'new\n');

  const info = await readGit(repo);
  assert.equal(info.branch, 'main');
  assert.equal(info.sha, expectedSha);
  assert.equal(info.detached, false);
  assert.equal(info.dirty, true);
  assert.equal(info.staged, 1);
  assert.equal(info.modified, 1);
  assert.equal(info.untracked, 1);
  assert.equal(info.conflicts, 0);

  // Default git rendering includes branch, dirty mark, and short SHA
  const prefs = normalizePreferences({ preset: 'cometix', segments: ['git'] });
  const segs = collectSegments({}, prefs, info);
  const rendered = stripAnsi(renderLine(segs, prefs, { width: 120, env: {} }));
  assert.match(rendered, new RegExp(`main.*${expectedSha}`));

  // Custom git format can interpolate staged, modified, untracked, and sha
  const cometixGit = PRESETS.cometix.rows[0].left.find(item => item.metric === 'git');
  const origFormat = cometixGit.format;
  try {
    cometixGit.format = '{branch}[ +{staged}][ ~{modified}][ ?{untracked}][ {sha}]';
    const customOut = stripAnsi(renderLine(segs, prefs, { width: 120, env: {} }));
    assert.match(customOut, new RegExp(`main \\+1 ~1 \\?1 ${expectedSha}`));
  } finally {
    cometixGit.format = origFormat;
  }

  // Detached HEAD uses short SHA without duplicating it
  runGit('checkout', '-q', '--detach', 'HEAD');
  const detached = await readGit(repo);
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, expectedSha);
  assert.equal(detached.sha, expectedSha);
  const detachedOut = stripAnsi(renderLine(collectSegments({}, prefs, detached), prefs, { width: 120, env: {} }));
  assert.equal(detachedOut.split(expectedSha).length - 1, 1);
});
