/**
 * Bounded git lookup. Argv is fixed; nothing from the payload is interpolated
 * into a shell. Non-repos, missing git, and unborn HEAD are empty results,
 * not errors the status line should crash on.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 400;
const MAX_BUFFER = 16 * 1024;

export async function readGit(cwd) {
  if (!cwd || typeof cwd !== "string") return null;
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.code !== 0 || inside.stdout.trim() !== "true") return null;

  const [branch, head, status, upstream, paths] = await Promise.all([
    git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]),
    git(cwd, ["status", "--porcelain", "--untracked-files=normal"]),
    git(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"]),
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
  return { branch: name, sha, detached, ...counts, ahead, behind, unborn, worktree };
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

async function git(cwd, args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
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
