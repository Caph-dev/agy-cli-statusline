import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stripAnsi } from '../lib/ansi.mjs';
import { countFileLines, parsePorcelain, parseShortstat, readGit } from '../lib/git.mjs';
import { ITEM_FORMAT_PRESETS, normalizePreferences, PRESETS } from '../lib/preferences.mjs';
import { renderLine } from '../lib/render.mjs';
import { SAMPLE_GIT } from '../lib/sample.mjs';
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

  // Nerd mode uses crisp single-width inline Git markers (*, ↑, ↓, !)
  const markedGit = { branch: 'main', sha: expectedSha, detached: false, dirty: true, ahead: 2, behind: 1, conflicts: 0 };
  const markedOut = stripAnsi(renderLine(collectSegments({}, prefs, markedGit), prefs, { width: 120, env: {} }));
  assert.match(markedOut, new RegExp(`\\u{f02a2} main \\* ↑2 ↓1 ${expectedSha}`, 'u'));
  const conflictPrefs = normalizePreferences({ preset: 'cometix', segments: ['git'], items: { git: { format: '{branch} {status}' } } });
  const conflictOut = stripAnsi(renderLine(collectSegments({}, conflictPrefs, { ...markedGit, conflicts: 1 }), conflictPrefs, { width: 120, env: {} }));
  assert.match(conflictOut, /\u{f02a2} main !/u);
});

test('parseShortstat and countFileLines handle singular/plural, empty, CRLF, and binary files', () => {
  assert.deepEqual(parseShortstat(''), { files: 0, insertions: 0, deletions: 0 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+)'), { files: 1, insertions: 1, deletions: 0 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 deletion(-)\n'), { files: 1, insertions: 0, deletions: 1 });
  assert.deepEqual(parseShortstat(' 3 files changed, 128 insertions(+), 34 deletions(-)\n'), {
    files: 3,
    insertions: 128,
    deletions: 34,
  });
  assert.deepEqual(parseShortstat(' 2 files changed, 0 insertions(+), 0 deletions(-)'), {
    files: 2,
    insertions: 0,
    deletions: 0,
  });

  assert.equal(countFileLines(Buffer.alloc(0)), 0);
  assert.equal(countFileLines(''), 0);
  assert.equal(countFileLines('single'), 1);
  assert.equal(countFileLines('one\n'), 1);
  assert.equal(countFileLines('one\ntwo'), 2);
  assert.equal(countFileLines('one\ntwo\n'), 2);
  assert.equal(countFileLines('one\r\ntwo\r\n'), 2);
  assert.equal(countFileLines(Buffer.from([0x41, 0x00, 0x0a, 0x42])), 0);
  const lateNul = Buffer.alloc(4096, 0x61);
  lateNul[3000] = 0;
  assert.equal(countFileLines(lateNul), 0);
});

test('readGit computes repo-wide changed files and added/deleted lines across unborn, staged, unstaged, deleted, and untracked files', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'agy-git-diffstat-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const runGit = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  runGit('init', '-b', 'main');
  runGit('config', 'user.email', 'test@example.com');
  runGit('config', 'user.name', 'Test User');

  // Unborn empty repo -> zero diff stats
  const unbornEmpty = await readGit(repo);
  assert.equal(unbornEmpty.files, 0);
  assert.equal(unbornEmpty.added, 0);
  assert.equal(unbornEmpty.deleted, 0);

  // Unborn repo with staged file (2 lines) + untracked file (3 lines)
  writeFileSync(join(repo, 'init-staged.txt'), 'a\nb\n');
  runGit('add', 'init-staged.txt');
  writeFileSync(join(repo, 'init-untracked.txt'), 'u1\nu2\nu3');
  const unbornDirty = await readGit(repo);
  assert.equal(unbornDirty.unborn, true);
  assert.equal(unbornDirty.files, 2);
  assert.equal(unbornDirty.added, 5);
  assert.equal(unbornDirty.deleted, 0);

  // Initial commit + clean check
  rmSync(join(repo, 'init-untracked.txt'));
  writeFileSync(join(repo, 'a.txt'), 'line1\nline2\n');
  writeFileSync(join(repo, 'both.txt'), 'b1\nb2\n');
  writeFileSync(join(repo, 'gone.txt'), 'g1\ng2\n');
  mkdirSync(join(repo, 'nested/dir'), { recursive: true });
  writeFileSync(join(repo, 'nested/dir/keep.txt'), 'k1\n');
  runGit('add', '.');
  runGit('commit', '-m', 'init');

  const clean = await readGit(repo);
  assert.equal(clean.files, 0);
  assert.equal(clean.added, 0);
  assert.equal(clean.deleted, 0);

  // 1. Staged new file: +3 lines
  writeFileSync(join(repo, 'staged-new.txt'), 's1\ns2\ns3\n');
  runGit('add', 'staged-new.txt');
  // 2. Unstaged modified file: replace line2 with two lines -> +2, -1
  writeFileSync(join(repo, 'a.txt'), 'line1\nline2-new\nline3-new\n');
  // 3. File with BOTH staged and unstaged edits (MM): counted once vs HEAD (+2 lines)
  writeFileSync(join(repo, 'both.txt'), 'b1\nb2\nb3-staged\n');
  runGit('add', 'both.txt');
  writeFileSync(join(repo, 'both.txt'), 'b1\nb2\nb3-staged\nb4-unstaged\n');
  // 4. Deleted tracked file: -2 lines
  rmSync(join(repo, 'gone.txt'));
  // 5. Untracked text file (no trailing newline): +4 lines
  writeFileSync(join(repo, 'untracked.txt'), 'u1\nu2\nu3\nu4');
  // 6. Untracked binary file: counted as 1 file with 0 added lines
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x01]));

  const stats = await readGit(repo);
  assert.equal(stats.files, 6);
  assert.equal(stats.added, 11); // 3 + 2 + 2 + 4 + 0
  assert.equal(stats.deleted, 3); // 1 + 2

  // Nested subdirectory returns identical repo-wide stats
  const nestedStats = await readGit(join(repo, 'nested/dir'));
  assert.equal(nestedStats.files, stats.files);
  assert.equal(nestedStats.added, stats.added);
  assert.equal(nestedStats.deleted, stats.deleted);
});

test('git format presets render diff stats with partial states, ASCII mode, and semantic green/red colors', () => {
  assert.equal(ITEM_FORMAT_PRESETS.git[0], '{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}]');

  // Verify every preset template in ITEM_FORMAT_PRESETS.git renders with SAMPLE_GIT
  const expectedSnippets = [
    /main \* ↑1 2f08999/,
    /main \* ↑1 2f08999 · 4f \+128 -34/,
    /main ↑1 · 4f \+128 -34/,
    /main \* \(4f \+128 -34\)/,
    /main 4f \+128 -34/,
    /main \* \+128 -34/,
    /main \+1 ~2 \?1 · 4f \+128 -34/,
    /main \* ↑1/,
    /main \+1 ~2 \?1 2f08999/,
    /main 2f08999/,
    /main/,
  ];
  assert.equal(ITEM_FORMAT_PRESETS.git.length, expectedSnippets.length);
  ITEM_FORMAT_PRESETS.git.forEach((format, index) => {
    const prefs = normalizePreferences({ preset: 'cometix', segments: ['git'], items: { git: { format } } });
    const segs = collectSegments({}, prefs, SAMPLE_GIT);
    const out = stripAnsi(renderLine(segs, prefs, { width: 120, env: {} }));
    assert.match(out, expectedSnippets[index], `preset[${index}]: ${format}`);
  });

  // Partial states & clean repo avoid orphan separators or parentheses
  const renderPreset = (git, formatIndex, extra = {}) => {
    const prefs = normalizePreferences({
      preset: 'cometix',
      segments: ['git'],
      items: { git: { format: ITEM_FORMAT_PRESETS.git[formatIndex] } },
      ...extra,
    });
    return renderLine(collectSegments({}, prefs, git), prefs, { width: 120, env: {} });
  };
  const addedOnly = stripAnsi(renderPreset({ branch: 'main', sha: '1234567', dirty: true, files: 2, added: 15, deleted: 0 }, 3));
  assert.match(addedOnly, /main \* \(2f \+15\)$/);
  const deletedOnly = stripAnsi(renderPreset({ branch: 'main', sha: '1234567', dirty: true, files: 1, added: 0, deleted: 7 }, 3));
  assert.match(deletedOnly, /main \* \(1f -7\)$/);
  const binaryOnly = stripAnsi(renderPreset({ branch: 'main', sha: '1234567', dirty: true, files: 1, added: 0, deleted: 0 }, 1));
  assert.match(binaryOnly, /main \* 1234567 · 1f$/);
  const clean = stripAnsi(renderPreset({ branch: 'main', sha: '1234567', dirty: false, files: 0, added: 0, deleted: 0 }, 1));
  assert.match(clean, /main 1234567$/);
  assert.doesNotMatch(clean, /·|\(\)/);

  // ASCII mode converts ' · ' to ' / ' and stays strictly ASCII
  const asciiOut = stripAnsi(renderPreset(SAMPLE_GIT, 1, { icons: 'ascii' }));
  assert.match(asciiOut, /^main \* \+1 2f08999 \/ 4f \+128 -34$/);
  assert.match(asciiOut, /^[\x20-\x7e]+$/);

  // Truecolor plain (tokyo-night): added -> ok (#9ece6a = 158;206;106), deleted -> crit (#f7768e = 247;118;142)
  const plainColor = renderPreset(SAMPLE_GIT, 1, { theme: 'tokyo-night', colorDepth: 'truecolor' });
  assert.match(plainColor, /\x1b\[38;2;158;206;106m\+128\x1b\[0m/);
  assert.match(plainColor, /\x1b\[38;2;247;118;142m-34\x1b\[0m/);

  // Dark powerline keeps high-contrast green/red on #1e2030 (30;32;48)
  const powerlineColor = renderPreset(SAMPLE_GIT, 1, { preset: 'powerline', colorDepth: 'truecolor' });
  assert.match(powerlineColor, /\x1b\[38;2;158;206;106;48;2;30;32;48m\+128\x1b\[0m/);
  assert.match(powerlineColor, /\x1b\[38;2;247;118;142;48;2;30;32;48m-34\x1b\[0m/);

  // Bright solid pill (catppuccin-mocha vcs #74c7ec -> 116;199;236) falls back to dark readable ink (#111111)
  const pillColor = renderPreset(SAMPLE_GIT, 1, { theme: 'catppuccin-mocha', skin: 'pill', colorDepth: 'truecolor' });
  assert.match(pillColor, /\x1b\[38;2;17;17;17;48;2;116;199;236m\+128\x1b\[0m/);
  assert.match(pillColor, /\x1b\[38;2;17;17;17;48;2;116;199;236m-34\x1b\[0m/);
});
