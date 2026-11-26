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
  let name = branch?.code === 0 ? branch.stdout.trim() : "";
  if (unborn) name = name ? `${name}*` : "unborn";
  else if (!name) {
    const detached = await git(cwd, ["rev-parse", "--short", "HEAD"]);
    name = detached?.stdout.trim() || "detached";
  }

  const porcelain = status?.code === 0 ? status.stdout : "";
  const lines = porcelain.split("\n").filter(Boolean);
  const dirty = lines.some((line) => !line.startsWith("##"));

  let ahead = 0;
  let behind = 0;
  if (upstream?.code === 0) {
    const [left, right] = upstream.stdout.trim().split(/\s+/).map((part) => Number(part) || 0);
    ahead = left;
    behind = right;
  }

  const [gitDir, commonDir, top] = paths?.code === 0 ? paths.stdout.trimEnd().split("\n") : [];
  const worktree = top && gitDir !== commonDir ? path.basename(top) : null;
  return { branch: name, dirty, ahead, behind, unborn, worktree };
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
