/**
 * Installed status-line command. agy runs this with a JSON payload on stdin
 * and expects one line on stdout. Preferences live beside this file.
 *
 * Also exported as main() so the package bin can render a sample without a
 * second copy of the pipeline.
 */

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readGit } from "./git.mjs";
import { normalizePreferences } from "./preferences.mjs";
import { renderLine } from "./render.mjs";
import { collectSegments } from "./segments.mjs";

export async function renderPayload(payload, preferences, { width, gitLookup = readGit } = {}) {
  const prefs = normalizePreferences(preferences);
  const cwd = workspaceCwd(payload);
  let git = null;
  if (prefs.segments.includes("git") && cwd) {
    try {
      git = await gitLookup(cwd);
    } catch {
      git = null;
    }
  }
  const segments = collectSegments(payload, prefs, git);
  const columns = width || payload?.terminal_width || 0;
  return renderLine(segments, prefs, { width: Number(columns) || 0, color: !process.env.NO_COLOR });
}

export async function main(argv = process.argv.slice(2), { stdin = process.stdin, stdout = process.stdout, source = "installed" } = {}) {
  if (argv.includes("--help")) {
    stdout.write("agy-cli-statusline runtime\nRead a status-line JSON payload from stdin and write one line.\n");
    return 0;
  }
  const raw = await readStdin(stdin);
  let payload = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      process.stderr.write(`statusline: malformed JSON on stdin: ${error.message}\n`);
      return 1;
    }
  }
  const preferences = loadInstalledPreferences(source);
  const line = await renderPayload(payload, preferences);
  stdout.write(`${line}\n`);
  return 0;
}

export function loadInstalledPreferences(source = "installed") {
  if (source !== "installed") return normalizePreferences();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, "statusline.json");
  try {
    return normalizePreferences(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return normalizePreferences();
  }
}

function workspaceCwd(payload) {
  const workspace = payload?.workspace;
  if (workspace && typeof workspace === "object") {
    return workspace.current_dir || workspace.project_dir || payload.cwd || "";
  }
  return payload?.cwd || "";
}

function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    if (stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks = [];
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(chunks.join("")));
    stdin.on("error", reject);
  });
}

if (invokedDirectly()) {
  const code = await main();
  process.exit(code);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const entry = process.argv[1];
  if (path.resolve(self) === path.resolve(entry)) return true;
  try {
    return realpathSync(self) === realpathSync(entry);
  } catch {
    return false;
  }
}
