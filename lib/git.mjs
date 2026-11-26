/**
 * Bounded git lookup. Argv is fixed; nothing from the payload is interpolated
 * into a shell. Non-repos, missing git, and unborn HEAD are empty results,
 * not errors the status line should crash on.
 */

import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 400;
const MAX_BUFFER = 16 * 1024;
const LS_FILES_MAX_BUFFER = 64 * 1024;
const MAX_UNTRACKED_READ_FILES = 64;
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 1024 * 1024;
const BINARY_PROBE_BYTES = 8192;

export async function readGit(cwd) {
  if (!cwd || typeof cwd !== "string") return null;
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.code !== 0 || inside.stdout.trim() !== "true") return null;

  const [branch, head, status, upstream, paths, diff] = await Promise.all([
    git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]),
    git(cwd, ["status", "--porcelain", "--untracked-files=normal"]),
    git(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"]),
    git(cwd, ["diff", "--no-color", "--no-ext-diff", "--shortstat", "HEAD", "--"], {
      env: { LC_ALL: "C", LANGUAGE: "C" },
    }),
  ]);

  const unborn = head?.code !== 0;
  const sha = !unborn && head?.code === 0 ? head.stdout.trim().slice(0, 7) : "";
  let name = branch?.code === 0 ? branch.stdout.trim() : "";
  const detached = !unborn && !name;
  if (unborn) name = name ? `${name}*` : "unborn";
  else if (!name) name = sha || "detached";

  const porcelain = status?.code === 0 ? status.stdout : "";
  const counts = parsePorcelain(porcelain);

  let ahead = 0;
  let behind = 0;
  if (upstream?.code === 0) {
    const [left, right] = upstream.stdout.trim().split(/\s+/).map((part) => Number(part) || 0);
    ahead = left;
    behind = right;
  }

  const [gitDir, commonDir, top] = paths?.code === 0 ? paths.stdout.trimEnd().split("\n") : [];
  const worktree = top && gitDir !== commonDir ? path.basename(top) : null;

  let diffStats;
  if (!unborn) {
    diffStats = diff?.code === 0 ? parseShortstat(diff.stdout) : { files: 0, insertions: 0, deletions: 0 };
  } else if (counts.staged > 0) {
    const cachedDiff = await git(cwd, ["diff", "--no-color", "--no-ext-diff", "--cached", "--shortstat"], {
      env: { LC_ALL: "C", LANGUAGE: "C" },
    });
    diffStats = cachedDiff?.code === 0 ? parseShortstat(cachedDiff.stdout) : { files: 0, insertions: 0, deletions: 0 };
  } else {
    diffStats = { files: 0, insertions: 0, deletions: 0 };
  }

  const untrackedStats = counts.untracked > 0
    ? await readUntrackedStats(top || cwd, counts.untracked)
    : { files: 0, added: 0 };

  const files = diffStats.files + untrackedStats.files;
  const added = diffStats.insertions + untrackedStats.added;
  const deleted = diffStats.deletions;

  return { branch: name, sha, detached, ...counts, files, added, deleted, ahead, behind, unborn, worktree };
}

export function parseShortstat(output) {
  const text = String(output ?? "");
  return {
    files: Number(/(\d+)\s+files?\s+changed/.exec(text)?.[1]) || 0,
    insertions: Number(/(\d+)\s+insertions?\(\+\)/.exec(text)?.[1]) || 0,
    deletions: Number(/(\d+)\s+deletions?\(-\)/.exec(text)?.[1]) || 0,
  };
}

export function countFileLines(buffer) {
  const buf = typeof buffer === "string"
    ? Buffer.from(buffer, "utf8")
    : Buffer.isBuffer(buffer)
      ? buffer
      : buffer instanceof Uint8Array
        ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : Buffer.alloc(0);
  if (buf.length === 0) return 0;
  const probeLen = Math.min(buf.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < probeLen; i += 1) {
    if (buf[i] === 0) return 0;
  }
  let lines = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) lines += 1;
  }
  if (buf[buf.length - 1] !== 0x0a) lines += 1;
  return lines;
}

async function readUntrackedStats(rootDir, fallbackCount) {
  const result = await git(rootDir, ["ls-files", "--others", "--exclude-standard", "-z"], {
    maxBuffer: LS_FILES_MAX_BUFFER,
  });
  if (!result || result.code !== 0) {
    return { files: fallbackCount, added: 0 };
  }
  const relPaths = result.stdout.split("\0").filter(Boolean);
  const files = relPaths.length;
  let added = 0;
  let totalBytes = 0;
  let inspected = 0;
  for (const relPath of relPaths) {
    if (inspected >= MAX_UNTRACKED_READ_FILES || totalBytes >= MAX_UNTRACKED_TOTAL_BYTES) break;
    try {
      const fullPath = path.join(rootDir, relPath);
      const st = await lstat(fullPath);
      if (!st.isFile()) continue;
      inspected += 1;
      if (st.size <= 0 || st.size > MAX_UNTRACKED_FILE_BYTES || totalBytes + st.size > MAX_UNTRACKED_TOTAL_BYTES) continue;
      const buf = await readFile(fullPath);
      totalBytes += buf.length;
      added += countFileLines(buf);
    } catch {
      continue;
    }
  }
  return { files, added };
}

export function parsePorcelain(porcelain) {
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicts = 0;
  let other = false;
  for (const line of String(porcelain ?? "").split(/\r?\n/)) {
    if (!line || line.startsWith("##")) continue;
    const x = line[0];
    const y = line[1] ?? " ";
    if (x === "!" && y === "!") continue;
    if (x === "?" && y === "?") {
      untracked += 1;
      continue;
    }
    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      conflicts += 1;
      continue;
    }
    let counted = false;
    if (x !== " " && x !== "?" && x !== "!") {
      staged += 1;
      counted = true;
    }
    if (y !== " " && y !== "?" && y !== "!") {
      modified += 1;
      counted = true;
    }
    if (!counted) other = true;
  }
  const dirty = staged > 0 || modified > 0 || untracked > 0 || conflicts > 0 || other;
  return { dirty, staged, modified, untracked, conflicts };
}

async function git(cwd, args, { env = null, maxBuffer = MAX_BUFFER } = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...(env ?? {}) },
    });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.killed)) return null;
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
    };
  }
}
