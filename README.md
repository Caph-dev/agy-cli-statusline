# agy-cli-statusline

[简体中文](./README.zh-CN.md)

Customize the footer in Antigravity CLI. Choose a preset, reorder metrics, and preview the result in a keyboard-driven terminal editor. The editor and agy use the same renderer.

Requires Node.js 22 or later and Antigravity CLI on macOS or Linux.

## Install and open the editor

After the npm package is published, run:

```sh
npx agy-cli-statusline
```

From a checkout, run `node bin/agy-cli-statusline.mjs`.

The command registers the footer and opens the editor. Use the editor's on-screen keys to select a preset, change the style, enable or reorder segments, and save. Run `agy` in a new session to see the footer. If you already use another status line, the editor asks before replacing it and keeps a backup of the original settings.

## Configure from inside agy

Install the plugin from GitHub.

```sh
agy plugin install https://github.com/Caph-dev/agy-cli-statusline
```

From a local checkout, use `agy plugin install .` instead.

Start `agy`. Type `/agy-cli-statusline-setup` and press Tab to accept the completion, then press Enter. You can also submit `/agy-cli-statusline:agy-cli-statusline-setup` directly. agy 1.5.18 requires the full name when submitting an installed plugin skill.

Choose a preset or describe the style and segments you want. The skill runs the bundled installer with those choices. Restart agy if the status line does not update in the current session.

## Use the command in scripts

Run `agy-cli-statusline --help` for supported presets and options. `configure --show` prints the current preferences and installation status. `configure` saves the supplied options and registers the footer. Use `--replace` to replace an existing custom status line. `preview` prints a sample footer.

Both install methods share preferences under `~/.gemini/antigravity-cli/agy-cli-statusline/`. The installer copies the renderer there and sets `statusLine` in `~/.gemini/antigravity-cli/settings.json`. The footer runs from that copy even if npm clears its cache or you remove the agy plugin.

The editor uses sample sessions to show each metric. In agy the footer uses live session data and hides unavailable metrics. Select Unicode or ASCII icons if your terminal does not use a Nerd Font.

## Visual reference

[CCometixLine](https://github.com/Haleclipse/CCometixLine) inspired the live preview, preset workflow, and colored status segments.
