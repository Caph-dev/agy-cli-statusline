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

Choose **English** or **简体中文**, then press **Enter**. Use the editor to select a preset, change the style, color depth, directory style (`auto`, `name`, `parent`, `tilde`, `short`, `full`), context display format (`auto`, `percent`, `% · used`, or `% · used/total`, e.g. `68% · 340k/500k`), or whether 5h/7d quota segments show pace deltas (`⇡` / `⇣`), and save. The `context` segment defaults to a dynamic proportional ring (`gauge`: 9-step Nerd Font `󰝦`–`󰪥` / 5-step Unicode `○◔◑◕●`, turning yellow at 70% and red at 90%, while bar presets such as `dashboard`/`budget`/`focus` keep their bars). Quota windows also show reset countdowns, Git shows the short HEAD SHA (and supports optional changed-file counts and line diff stats via `{files}`, `{added}`, `{deleted}` plus built-in format presets in the segment editor), and narrow terminals wrap overflowing rows onto additional lines at full fidelity without degrading or dropping segments. On first launch, the command also registers the footer. Run `agy` in a new session to see the footer. If you already use another status line, the editor asks before replacing it and keeps a backup of the original settings.

## Reorder and edit segments

1. Select **segments** and press **Enter** to open the layout editor.
2. Use **↑** and **↓** to select an enabled segment. Press **Enter** to pick it up.
3. Use **↑** and **↓** to move the segment, then press **Enter** to drop it. The preview updates as you move it. Press **Esc** while moving to undo the move.
4. Press **e** or **→** on an enabled segment to edit its **widget** (when supported), **icon**, and **format** template (`{field}` and optional `[...]` groups). Use **←**/**→** to cycle presets, **Enter** to type a custom icon or template, and **r** to reset to the preset default.
5. Press **Ctrl+S** to save, or **Esc** to return to settings.

Press **Space** to enable or disable a segment. New segments appear at the end.

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

## Use CCometixLine presets and palettes

Choose `cometix`, `minimal`, `dashboard`, `budget`, `cache-aware`, `focus`, `zen`, or `powerline`. The editor includes all 13 CCometixLine palettes and retains the original agy-cli-statusline styles. Existing version 1 `focus` settings use `focus-legacy`.

To preview Dashboard in 256 colors from the checkout, run:

```sh
node bin/agy-cli-statusline.mjs preview --preset dashboard --color-depth 256
```

Choose `auto`, `truecolor`, `256`, `16`, or `none` for color depth. `auto` checks `COLORTERM` and `TERM`. `zen` defaults to `none`. agy provides model, context, quota, cost, subagent, and cache-token data. The `cache` segment aligns with CCometixLine (showing warm/cold TTL countdown, session cache hit ratio `{hit}% hit`, hit-ratio-only presets `{hit}% hit` and `{hit}%`, optional miss count `{misses}`, last miss cause `{cause}`, estimated rewarm cost `{rewarm}`, and `text` / `bar` / `gauge` widgets — including `cache-aware`'s dots countdown bar), deriving live prompt-cache metrics from the local Antigravity conversation SQLite database (`~/.gemini/antigravity-cli/conversations/*.db`, read-only via `node:sqlite`) when `prompt_cache` is absent and falling back to `context_window.current_usage`. The `tps` (generation speed in `tok/s` with optional `{ttft}` / `{median}`) and `cost.today` (estimated today's API-list spend since local midnight) segments share the same mtime-cached SQLite reader, and `cost` also falls back to the current conversation's estimated spend when agy omits `cost`. The `subagents` segment (adapted from `agy-zh-pack`, enabled by default in `studio` and `signal`, and optional in all presets) renders an aligned multi-line subagent tree (`├` / `└`, up to 4 rows plus `+N more subagents`) showing each subagent's type and role, model, context ring/tokens, cache hit ratio, own estimated cost, and live status (`● elapsed`, `● waiting`, or `✓ done elapsed · N steps`, collapsing completed subagents after 10 seconds), or switches to a single-line `inline` summary widget; it merges `payload.subagents` with local `conversation_summaries.db` and active subagent conversation databases. Presets still skip Claude Code-only metrics such as updates, compaction thresholds, and context history. A quota window appears when agy identifies the bucket as five-hour or weekly.

See [third-party notices](./THIRD_PARTY_NOTICES.md) for the CCometixLine and agy-zh-pack sources and licenses.
