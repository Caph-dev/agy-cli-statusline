/**
 * Config root and installed-runtime paths.
 *
 * AGY_CLI_STATUSLINE_HOME, when set, replaces ~/.gemini/antigravity-cli.
 * It exists so tests never touch a real home directory. An empty value is
 * treated as unset. Relative values resolve against the process cwd.
 */

import os from "node:os";
import path from "node:path";

export const CONFIG_DIR_NAME = "antigravity-cli";
export const SETTINGS_FILE = "settings.json";
export const PREFERENCES_FILE = "statusline.json";
export const RUNTIME_DIR_NAME = "agy-cli-statusline";
export const PRESETS_DIR_NAME = "presets";
export const RUNTIME_BIN = "statusline.mjs";
export const ENV_HOME = "AGY_CLI_STATUSLINE_HOME";

export function configRoot(env = process.env, home = os.homedir()) {
  const override = env[ENV_HOME];
  if (typeof override === "string" && override.length > 0) {
    return path.resolve(override);
  }
  return path.join(home, ".gemini", CONFIG_DIR_NAME);
}

export function settingsPath(root = configRoot()) {
  return path.join(root, SETTINGS_FILE);
}

export function preferencesPath(root = configRoot()) {
  return path.join(root, RUNTIME_DIR_NAME, PREFERENCES_FILE);
}

export function runtimeDir(root = configRoot()) {
  return path.join(root, RUNTIME_DIR_NAME);
}

export function presetsDir(root = configRoot()) {
  return path.join(runtimeDir(root), PRESETS_DIR_NAME);
}

export function runtimeEntry(root = configRoot()) {
  return path.join(runtimeDir(root), RUNTIME_BIN);
}
