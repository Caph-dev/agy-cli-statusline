#!/usr/bin/env node

/**
 * agy-cli-statusline
 *
 *   (no args)     install the default, keep saved preferences, open the editor on a TTY
 *   configure     write preferences and install, non-interactively
 *   preview       render the sample payload, no file writes
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { confirmReplace, runEditor, selectLanguage } from "../lib/editor.mjs";
import { configRoot } from "../lib/paths.mjs";
import {
  enumNames,
  normalizePreferences,
  parseSegments,
  SEGMENT_IDS,
  PreferenceError,
} from "../lib/preferences.mjs";
import { SAMPLE_GIT, samplePayload } from "../lib/sample.mjs";
import { inspectInstall, install, SettingsConflict, SettingsError } from "../lib/settings.mjs";
import { renderPayload } from "../lib/statusline.mjs";

const SOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `agy-cli-statusline
Install and design the Antigravity CLI status line.

Usage
  agy-cli-statusline
  agy-cli-statusline configure [options]
  agy-cli-statusline preview [options]
  agy-cli-statusline --help

configure options
  --show                 print current preferences and install status as JSON
  --preset NAME          ${enumNames("preset").join(" | ")}
  --theme NAME           ${enumNames("theme").join(" | ")}
  --skin NAME            ${enumNames("skin").join(" | ")}
  --icons NAME           ${enumNames("icons").join(" | ")}
  --color-depth MODE     auto | truecolor | 256 | 16 | none
  --segments CSV         ordered ids: ${SEGMENT_IDS.join(",")}
  --replace              replace a statusLine command this tool does not own

preview options
  the same style and layout options as configure; no files are written

On a TTY, choose a language before opening the editor. First-time setup
registers the status line; existing preferences are preserved. A statusLine owned by something else is not replaced without --replace
or an explicit confirmation. AGY_CLI_STATUSLINE_HOME overrides the config root
(~/.gemini/antigravity-cli) for tests.
`;

export async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  const root = io.root ?? configRoot();
  try {
    const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "";
    const flags = parseArgs(command ? argv.slice(1) : argv);
    if (flags.help || argv.includes("--help") || argv.includes("-h")) {
      stdout.write(HELP);
      return 0;
    }
    if (!command) return await runDefault({ flags, root, stdin, stdout, stderr });
    if (command === "configure") return await runConfigure({ flags, root, stdout, stderr });
    if (command === "preview") return await runPreview({ flags, stdout });
    stderr.write(`unknown command '${command}'\n\n${HELP}`);
    return 2;
  } catch (error) {
    if (error instanceof PreferenceError || error instanceof SettingsError || error instanceof UsageError) {
      stderr.write(`${error.message}\n`);
      return error instanceof SettingsConflict ? 3 : 2;
    }
    throw error;
  }
}

async function runDefault({ flags, root, stdin, stdout, stderr }) {
  const stray = Object.keys(flags).filter((key) => !["help", "show", "replace"].includes(key));
  if (stray.length > 0) {
    throw new UsageError("flags belong on configure or preview; run with no arguments to open the editor");
  }
  const current = inspectInstall(root);
  if (!stdin.isTTY || !stdout.isTTY) {
    stderr.write(
      [
        "not a TTY, so the editor was not opened and settings were not changed.",
        `config root: ${root}`,
        current.ownership === "foreign"
          ? "a different statusLine is configured. Re-run with: configure --replace ..."
          : "write a configuration with: configure [--preset NAME] [--theme NAME] [--skin NAME] [--icons NAME] [--segments CSV]",
        "read the current state with: configure --show",
        "",
      ].join("\n"),
    );
    return current.ownership === "foreign" ? 3 : 0;
  }
  const language = await selectLanguage({ stdin, stdout });
  if (!language) return 0;
  const zh = language === "zh";
  let replace = flags.replace === true;
  if (current.ownership === "foreign" && !replace) {
    replace = await confirmReplace({ stdin, stdout, language, command: current.statusLine?.command || "" });
    if (!replace) {
      stderr.write(zh ? "已保留现有状态栏\n" : "left the existing statusLine unchanged\n");
      return 3;
    }
  }
  const starting = current.preferencesExist ? current.preferences : normalizePreferences();
  if (!current.installed || replace) {
    install(root, starting, { replace, sourceDir: SOURCE_DIR });
  }
  const session = await runEditor({
    preferences: starting,
    stdin,
    stdout,
    language,
    onSave: async (preferences) => {
      install(root, preferences, { sourceDir: SOURCE_DIR });
    },
  });
  if (zh) stderr.write(session.saved ? "已保存\n" : "已取消\n");
  else stderr.write(session.saved ? "saved\n" : "cancelled\n");
  return 0;
}

async function runConfigure({ flags, root, stdout, stderr }) {
  if (flags.show) {
    if (hasWriteFlags(flags)) throw new UsageError("configure --show is read-only; remove the other options");
    const info = inspectInstall(root);
    stdout.write(`${JSON.stringify(publicInfo(info), null, 2)}\n`);
    return 0;
  }
  const current = inspectInstall(root);
  const preferences = resolveWrite(current, flags);
  const result = install(root, preferences, { replace: flags.replace === true, sourceDir: SOURCE_DIR });
  stderr.write(`installed ${result.command}\n`);
  if (result.backup) stderr.write(`backup ${result.backup}\n`);
  stdout.write(`${JSON.stringify({ preferences: result.preferences, settingsFile: result.settingsFile }, null, 2)}\n`);
  return 0;
}

async function runPreview({ flags, stdout }) {
  const preferences = normalizePreferences(explicit(flags));
  const payload = samplePayload();
  const line = await renderPayload(payload, preferences, {
    width: payload.terminal_width,
    gitLookup: async () => SAMPLE_GIT,
  });
  stdout.write(`${line}\n`);
  return 0;
}

function resolveWrite(current, flags) {
  const explicitFlags = explicit(flags);
  if (Object.keys(explicitFlags).length === 0) return current.preferences;
  const preset = explicitFlags.preset;
  const base = preset ? { preset } : current.preferences;
  const options = { ...base, ...explicitFlags };
  if (explicitFlags.segments) delete options.layout;
  return normalizePreferences(options);
}

function explicit(flags) {
  const out = {};
  for (const key of ["preset", "theme", "skin", "icons", "colorDepth"]) {
    if (flags[key] != null) out[key] = flags[key];
  }
  if (flags.segments != null) out.segments = parseSegments(flags.segments);
  return out;
}

function hasWriteFlags(flags) {
  return ["preset", "theme", "skin", "icons", "colorDepth", "segments", "replace"].some((key) => flags[key] != null && flags[key] !== false);
}

function publicInfo(info) {
  return {
    root: info.root,
    installed: info.installed,
    ownership: info.ownership,
    settingsFile: info.settingsFile,
    preferencesFile: info.preferencesFile,
    preferences: info.preferences,
    runtime: info.runtime,
    enums: {
      preset: enumNames("preset"),
      theme: enumNames("theme"),
      skin: enumNames("skin"),
      icons: enumNames("icons"),
      colorDepth: ["auto", "truecolor", "256", "16", "none"],
      segments: SEGMENT_IDS,
    },
  };
}

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "--show") {
      flags.show = true;
      continue;
    }
    if (token === "--replace") {
      flags.replace = true;
      continue;
    }
    const known = ["--preset", "--theme", "--skin", "--icons", "--color-depth", "--segments"];
    if (!known.includes(token)) throw new UsageError(`unknown option '${token}'`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`${token} needs a value`);
    flags[token === "--color-depth" ? "colorDepth" : token.slice(2)] = value;
    index += 1;
  }
  return flags;
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

try {
  const code = await main();
  process.exitCode ??= code;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
