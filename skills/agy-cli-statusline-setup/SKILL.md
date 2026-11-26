---
name: agy-cli-statusline-setup
description: Install or configure the agy-cli-statusline footer, including its preset, theme, skin, icons, directory style, context format, quota pace deltas, multi-row layout, and segments. Use when the user runs /agy-cli-statusline-setup or asks to configure this status line.
---

# Configure Status Line Studio

1. Run `agy plugin list --json` and find the enabled entry whose `name` is `agy-cli-statusline`. Append `/bin/agy-cli-statusline.mjs` to its `path` field. Use this absolute path for the remaining steps.
2. Run `node '<installed-plugin-directory>/bin/agy-cli-statusline.mjs' configure --show` to read the current options and installation state. Run the same script with `--help` to see valid values. Quote the installed path for the current shell.
3. Apply explicit choices from the user's request. If the user gave no options, offer the built-in presets and ask which one to apply or whether to keep the current look. Ask about individual style and layout options only if the user wants them. For custom multi-row layouts with per-row auto-wrapping, use `--segments` with `/` for forced line breaks (and optional `|` for left/right split) or `--layout` (`flat`, `preset`, or `L[:R],L[:R]...`).
4. Apply the chosen options with `node '<installed-plugin-directory>/bin/agy-cli-statusline.mjs' configure` and the corresponding flags from the script's help. Omit options that the user did not change. If the script reports a different configured status line, explain that replacement backs up agy's settings and ask before retrying with `--replace`.
5. Report the applied choices and tell the user to restart agy if the footer does not refresh. If the user wants to edit with a live preview, give them the installed script's command without arguments to run in a separate shell.

If the plugin directory cannot be located or Node.js 22+ cannot run, report the error. Do not edit settings by hand or download another installer.
