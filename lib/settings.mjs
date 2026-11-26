/**
 * Read and write agy settings plus this app's preferences.
 *
 * settings.json belongs to agy. We only replace statusLine, and only after
 * the file parses as an object. Other keys are copied through unchanged.
 * A foreign statusLine is left alone unless replace is explicit.
 */

import { randomBytes } from "node:crypto";
import { constants as fsConstants, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizePreferences, PreferenceError } from "./preferences.mjs";
import { preferencesPath, runtimeDir, runtimeEntry, settingsPath } from "./paths.mjs";

const RUNTIME_FILES = [
  "ansi.mjs",
  "ccline-data.mjs",
  "git.mjs",
  "paths.mjs",
  "preferences.mjs",
  "render.mjs",
  "segments.mjs",
  "settings.mjs",
  "statusline.mjs",
  "telemetry.mjs",
  "template.mjs",
];

export function readSettings(root) {
  const file = settingsPath(root);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { file, exists: false, value: {} };
    throw new SettingsError(`cannot read ${file}: ${error.message}`);
  }
  if (text.trim() === "") return { file, exists: true, value: {} };
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SettingsError(`malformed settings in ${file}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsError(`malformed settings in ${file}: expected an object`);
  }
  return { file, exists: true, value };
}

export function readPreferences(root) {
  const file = preferencesPath(root);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { file, exists: false, value: normalizePreferences() };
    throw new SettingsError(`cannot read ${file}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SettingsError(`malformed preferences in ${file}: ${error.message}`);
  }
  try {
    return { file, exists: true, value: normalizePreferences(parsed) };
  } catch (error) {
    if (error instanceof PreferenceError) {
      throw new SettingsError(`malformed preferences in ${file}: ${error.message}`);
    }
    throw error;
  }
}

export function inspectInstall(root) {
  const settings = readSettings(root);
  const preferences = readPreferences(root);
  const statusLine = settings.value.statusLine ?? null;
  const ownership = classifyStatusLine(statusLine, root);
  return {
    root,
    settingsFile: settings.file,
    settingsExist: settings.exists,
    preferencesFile: preferences.file,
    preferencesExist: preferences.exists,
    preferences: preferences.value,
    statusLine,
    ownership,
    installed: ownership === "own" && statusLine.enabled !== false && runtimePresent(root),
    runtime: runtimeEntry(root),
  };
}

function classifyStatusLine(statusLine, root) {
  if (statusLine == null) return "empty";
  if (typeof statusLine !== "object" || Array.isArray(statusLine)) return "foreign";
  const command = typeof statusLine.command === "string" ? statusLine.command : "";
  if (!command && Object.keys(statusLine).length === 0) return "empty";
  if (statusLine.type != null && statusLine.type !== "command") return "foreign";
  const renderer = " " + quotePosix(runtimeEntry(root));
  if (!command.endsWith(renderer)) return "foreign";
  const executable = command.slice(0, -renderer.length);
  return /^'\/(?:[^']|'\\'')*\/node'$/.test(executable) ? "own" : "foreign";
}

export function runtimePresent(root) {
  try {
    readFileSync(runtimeEntry(root), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate, then write. `replace` is required when a foreign statusLine exists.
 * Preferences are written first; settings are backed up, then replaced atomically.
 * If the settings write fails, the backup remains and the error names it.
 */
export function install(root, preferences, { replace = false, nodePath = process.execPath, sourceDir } = {}) {
  const normalized = normalizePreferences(preferences);
  const current = readSettings(root);
  const ownership = classifyStatusLine(current.value.statusLine, root);
  if (ownership === "foreign" && !replace) {
    throw new SettingsConflict("a different statusLine is already configured", current.value.statusLine);
  }
  const from = sourceDir ?? defaultSourceDir();
  assertRuntimeSource(from);
  const destination = runtimeDir(root);
  mkdirSync(destination, { recursive: true });
  copyRuntime(from, destination);
  writeJsonAtomic(preferencesPath(root), normalized);
  const command = buildCommand(nodePath, runtimeEntry(root));
  const previous = ownership === "own" ? current.value.statusLine : {};
  const statusLine = { ...previous, type: "command", command, padding: previous.padding ?? 0 };
  if (statusLine.enabled === false) statusLine.enabled = true;
  const changed = JSON.stringify(current.value.statusLine) !== JSON.stringify(statusLine);
  const backup = changed && current.exists ? backupSettings(current.file) : null;
  if (changed) writeJsonAtomic(current.file, { ...current.value, statusLine });
  return {
    preferences: normalized,
    command,
    backup,
    replaced: ownership === "foreign",
    settingsFile: current.file,
  };
}

export function buildCommand(nodePath, entry) {
  return `${quotePosix(nodePath)} ${quotePosix(entry)}`;
}

export function quotePosix(value) {
  const text = String(value);
  if (text.length === 0) return "''";
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function defaultSourceDir() {
  return path.dirname(path.dirname(new URL(import.meta.url).pathname));
}

function assertRuntimeSource(sourceDir) {
  for (const file of RUNTIME_FILES) {
    const from = path.join(sourceDir, "lib", file);
    try {
      readFileSync(from);
    } catch {
      throw new SettingsError(`renderer source missing: ${from}`);
    }
  }
}

function copyRuntime(sourceDir, destination) {
  mkdirSync(destination, { recursive: true });
  for (const file of RUNTIME_FILES) {
    copyFileSync(path.join(sourceDir, "lib", file), path.join(destination, file));
  }
}

function backupSettings(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = randomBytes(3).toString("hex");
  const backup = `${file}.bak-${stamp}-${nonce}`;
  copyFileSync(file, backup, fsConstants.COPYFILE_EXCL);
  return backup;
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const nonce = randomBytes(4).toString("hex");
  const temporary = `${file}.${nonce}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, file);
  } catch (error) {
    throw new SettingsError(`cannot write ${file}: ${error.message}`);
  }
}

export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsError";
  }
}

export class SettingsConflict extends SettingsError {
  constructor(message, statusLine) {
    super(message);
    this.name = "SettingsConflict";
    this.statusLine = statusLine;
  }
}
