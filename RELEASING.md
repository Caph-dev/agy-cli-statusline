# Releasing

Maintainer notes. Nothing here is needed to *use* the package.

## One-time setup

npm refuses to accept a publish from a plain login token — it demands either an account with 2FA
(a browser prompt on every publish) or a granular access token with **Bypass two-factor
authentication** enabled. The token is the quieter option, and the one an agent can use without a
browser prompt:

1. Open https://www.npmjs.com/settings/caph42/tokens → **Generate New Token** → **Granular Access
   Token**.
2. **Packages and scopes**: choose **Only select packages and scopes**, then select the existing
   unscoped package `agy-cli-statusline` only. In **Permissions**, choose **Read and write (publish
   and stage)**. Do not choose **Read and write (stage only)** — that token cannot publish — and do
   not choose **All Packages** or grant organization write access. Leave **Allowed IP Ranges** empty
   unless this machine has a stable address. If the package is missing from the list, run
   `npm owner ls agy-cli-statusline` and confirm `caph42` is a maintainer before generating another
   token.
3. Check **Bypass two-factor authentication**. Without it, `npm publish` fails with
   `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`.
4. **Expiration**: only as long as this publishing setup needs. When it lapses, publishes fail with
   `401`/`403` — generate a new token.
5. Keep the token out of the shared `~/.npmrc` used by other packages such as `@caph42/pi-jev-router`.
   Write an agent-only file, mode `0600`, and point npm at it. The repository `.gitignore` only
   ignores a `.npmrc` inside this checkout; it does not protect `~/.npmrc`.

   ```sh
   file="$HOME/.config/agy-cli-statusline/npmrc"
   mkdir -p "$(dirname "$file")"
   (umask 077 && touch "$file")
   chmod 600 "$file"
   ```

   ```ini
   //registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxxxxxx
   ```

   ```sh
   NPM_CONFIG_USERCONFIG="$HOME/.config/agy-cli-statusline/npmrc" npm whoami
   ```

Do **not** run `npm logout` while that file is the active userconfig — it revokes the token in use,
including the new one. To drop an older session token, delete it from the token list on npmjs.com
instead.

## Release checklist

```sh
cd ~/Workspace/agy-cli-statusline

git status --short          # must be clean
git pull                    # stay in sync with origin
npm test                    # prepublishOnly runs this again
npm pack --dry-run          # verify the package name, version, and file list
npm version patch           # or minor / major — see below
git push --follow-tags
NPM_CONFIG_USERCONFIG="$HOME/.config/agy-cli-statusline/npmrc" npm publish
```

`publishConfig.access` is `public`, so `--access public` is optional. The package name stays
unscoped (`agy-cli-statusline`); do not rename it to `@caph42/agy-cli-statusline` on a later
release — that would publish a different package.

Before bumping, check that both READMEs still match the segments, presets, and install commands.

## Verify the release

```sh
version=$(node -p "require('./package.json').version")

# query the version just published, not whatever `latest` already was
npm view "agy-cli-statusline@$version" version dist-tags dist.tarball dist.integrity

# download that same version without leaving the repository directory
(cd "$(mktemp -d)" && npm pack "agy-cli-statusline@$version" && tar tzf "agy-cli-statusline-$version.tgz")
```

Compare `dist.integrity` from `npm view` with the `integrity` field from `npm pack --dry-run --json`.
They must be equal. Also confirm the tag moved to this version: `dist-tags.latest` for a normal release,
`dist-tags.next` for a prerelease. Polling `npm view agy-cli-statusline version` is not enough: the already
published `1.0.0` would look like success, and a prerelease on the `next` tag would not move `latest`.

The tarball must contain `bin/`, `lib/`, `plugin.json`, `skills/`, `THIRD_PARTY_NOTICES.md`, and
the license. It must not contain `.npmrc`, tests, or local conversation data.

## Versioning

| Bump | When |
| --- | --- |
| patch | bug fixes, docs, rendering fixes that keep existing `statusline.json` files working |
| minor | new segments, presets, or format fields that keep existing configs working |
| major | removed or renamed segments, changed defaults, or anything that changes an existing status line |

Prereleases stay off the `latest` tag, so nobody installs them by accident:

```sh
npm version prerelease --preid=rc    # 1.0.0 → 1.0.1-rc.0
git push --follow-tags
NPM_CONFIG_USERCONFIG="$HOME/.config/agy-cli-statusline/npmrc" npm publish --tag next
```

A version can never be published twice. If a release is wrong, publish the next patch rather than
trying to overwrite it.

## Publishing is asynchronous

npm answers `202 Accepted` with *"Your package is being processed and may take a few minutes to
become available"*, and the read API can keep serving `404` for a minute or two after that. This is
normal; poll instead of re-publishing:

```sh
set -e
version=$(node -p "require('./package.json').version")
expected_integrity=$(npm pack --dry-run --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s)[0].integrity; if(!v) process.exit(1); process.stdout.write(v)})')
[ -n "$expected_integrity" ] || exit 1
remote=""
for i in $(seq 1 12); do
  remote=$(npm view "agy-cli-statusline@$version" dist.integrity 2>/dev/null || true)
  [ "$remote" = "$expected_integrity" ] && break
  sleep 15
done
[ "$remote" = "$expected_integrity" ] || exit 1
tag=$(npm view "agy-cli-statusline@$version" dist-tags.latest)
[ "$tag" = "$version" ] || exit 1
```

For a prerelease, check `dist-tags.next` instead of `dist-tags.latest`.

## Gotchas

- The package is unscoped and already public as `agy-cli-statusline`. `publishConfig.access =
  "public"` records that so a later scoped rename is not required for this package.
- `prepublishOnly` runs `npm test`. A failing test blocks the publish.
- The `files` array decides what the tarball contains. Check that it includes `bin/`, `lib/`,
  `plugin.json`, `skills/`, and `THIRD_PARTY_NOTICES.md`.
- `.npmrc`, `node_modules/`, and `*.tgz` are gitignored — keep it that way.

## 中文速览

发布前准备：在 npm 网页生成 **Granular Access Token**，只选已存在的未加 scope 包
`agy-cli-statusline`，权限选 **Read and write (publish and stage)**，勾 **Bypass two-factor authentication**。不要选 **stage only**、**All Packages** 或组织写权限。
token 写进专用文件 `~/.config/agy-cli-statusline/npmrc`（权限 `0600`），发布时用
`NPM_CONFIG_USERCONFIG` 指向它，不要覆盖 `~/.npmrc` 里别的包（比如 `@caph42/pi-jev-router`）正在用的凭据。
换上新 token 后**不要**执行 `npm logout`（会把新 token 一起吊销）。

发版流程：`git status` 干净 → `npm test` → `npm pack --dry-run` 确认包名、版本和文件清单 → `npm version
patch|minor|major` → `git push --follow-tags` → 带上面的 `NPM_CONFIG_USERCONFIG` 执行 `npm publish`。

npm 发布是异步的：返回 `202` 且“being processed”，读接口可能再 404 一两分钟，**不要急着重发**。
轮询 `npm view "agy-cli-statusline@<刚发的版本>" dist.integrity`，再和本地 `npm pack --dry-run --json` 的
`integrity` 比对。不要只查 `npm view agy-cli-statusline version`：已经发布的 `1.0.0` 会让检查提前通过。

包名保持不加 scope 的 `agy-cli-statusline`。修复发 patch；新增且兼容旧 `statusline.json` 的组件发
minor；删除或改名组件、改变已有状态栏默认行为时发 major。
