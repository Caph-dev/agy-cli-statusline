/**
 * Installed status-line command. agy runs this with a JSON payload on stdin
 * and displays the rendered rows from stdout. Preferences live beside this file.
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
import { readTelemetry } from "./telemetry.mjs";

function defaultTelemetryLookup(payload, prefs, { now } = {}) {
  const enabled = new Set(prefs.segments);
  const mainModel = [payload?.model?.id, payload?.model?.display_name].filter(Boolean).join(" ");
  const hasPayloadOrch = Boolean(payload?.orchestrator || payload?.model?.orchestrator);
  const needTps = enabled.has("tps") && !payload?.tps;
  const needTodayCost = enabled.has("cost.today") && !payload?.cost_today;
  const needSessionCost = enabled.has("cost") && payload?.cost?.total_usd == null;
  // Always load the conversation when cache is shown. A partial prompt_cache
  // (warm/TTL only, which is all agy sends) must not hide the last call's tokens.
  const needCache = enabled.has("cache");
  const needSubagents = enabled.has("subagents");
  const needOrchestrator = enabled.has("model") && /orchestrator/i.test(mainModel) && !hasPayloadOrch;
  if (!needTps && !needTodayCost && !needSessionCost && !needCache && !needSubagents && !needOrchestrator) return null;
  const conversationId = payload?.conversation_id || payload?.session_id || "";
  const contextWindowSize = Number(payload?.context_window?.context_window_size) || 0;
  return readTelemetry({
    conversationId,
    needTps,
    needTodayCost,
    needSessionCost,
    needCache,
    needSubagents,
    needOrchestrator,
    contextWindowSize,
    mainModel,
    now,
  });
}

export async function renderPayload(
  payload,
  preferences,
  { width, gitLookup = readGit, telemetryLookup = defaultTelemetryLookup, home, now } = {},
) {
  const prefs = normalizePreferences(preferences);
  const cwd = workspaceCwd(payload);
  const gitPromise = cwd && (prefs.segments.includes("git") || prefs.segments.includes("worktree"))
    ? Promise.resolve(gitLookup(cwd)).catch(() => null)
    : Promise.resolve(null);
  const telemetryPromise = Promise.resolve(telemetryLookup(payload, prefs, { now })).catch(() => null);
  const [git, telemetry] = await Promise.all([gitPromise, telemetryPromise]);
  const options = { telemetry };
  if (home !== undefined) options.home = home;
  if (now !== undefined) options.now = now;
  const segments = collectSegments(payload, prefs, git, options);
  const columns = width || payload?.terminal_width || 0;
  return renderLine(segments, prefs, { width: Number(columns) || 0, color: !process.env.NO_COLOR });
}

export async function main(argv = process.argv.slice(2), { stdin = process.stdin, stdout = process.stdout, source = "installed" } = {}) {
  if (argv.includes("--help")) {
    stdout.write("agy-cli-statusline runtime\nRead a status-line JSON payload from stdin and write the rendered rows.\n");
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
