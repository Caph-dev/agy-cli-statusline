# agy-cli-statusline

[English](./README.md)

自定义 Antigravity CLI（agy）的状态栏。在终端编辑器中切换预设、调整分段顺序，并实时预览效果。编辑器与 agy 状态栏使用同一个渲染器。

需要 Node.js 22 或更高版本，以及 macOS 或 Linux 上的 Antigravity CLI。

## 安装状态栏并打开编辑器

npm 包发布后，运行以下命令。

```sh
npx agy-cli-statusline
```

如果你已克隆仓库，在仓库根目录运行 `node bin/agy-cli-statusline.mjs`。

选择 **English** 或 **简体中文**，按 **Enter** 确认。进入编辑器后，可以选择预设、调整样式、色深或上下文显示格式（自动、仅百分比、百分比 · 已用、百分比 · 已用/上限，例如 `68% · 340k/500k`），再保存。首次运行会注册状态栏。重新启动 `agy` 查看效果。如果你已配置其他状态栏，编辑器会先询问是否替换。确认替换后，安装器会备份原设置。

## 调整区块顺序

1. 选中 **区块**，按 **Enter** 打开布局编辑器。
2. 用 **↑**、**↓** 选中一个已启用的区块，按 **Enter** 拿起。
3. 用 **↑**、**↓** 移动区块，再按 **Enter** 放下。预览会随顺序更新。移动中按 **Esc** 可撤销本次移动。
4. 按 **Ctrl+S** 保存，或按 **Esc** 返回设置页。

按 **空格** 启用或关闭区块。新启用的区块出现在末尾。

## 在 agy 中配置

运行以下命令从 GitHub 安装插件。

```sh
agy plugin install https://github.com/Caph-dev/agy-cli-statusline
```

如果你已克隆仓库，在仓库根目录运行 `agy plugin install .`。

启动 `agy`，输入 `/agy-cli-statusline-setup`。先按 **Tab** 接受补全，再按 **Enter** 提交。你也可以直接提交 `/agy-cli-statusline:agy-cli-statusline-setup`。agy 1.5.18 要求使用带插件命名空间的完整 Skill 命令。

选择一个预设，或描述想要的样式和分段。Skill 会调用插件自带的安装器保存配置。如果当前会话的状态栏没有更新，请重启 agy。

## 在脚本中配置

运行 `agy-cli-statusline --help` 查看预设和可用选项。

- `agy-cli-statusline configure --show` 显示当前配置和安装状态。
- `agy-cli-statusline configure` 保存指定选项并注册状态栏。添加 `--replace` 可替换已有的自定义状态栏。
- `agy-cli-statusline preview` 输出示例状态栏。

两种安装方式共用 `~/.gemini/antigravity-cli/agy-cli-statusline/` 下的配置。安装器将渲染器复制到该目录，并在 `~/.gemini/antigravity-cli/settings.json` 中设置 `statusLine`。清除 npm 缓存或卸载 agy 插件后，已注册的状态栏仍从该目录运行。

编辑器使用示例数据预览各项指标。agy 中的状态栏读取当前会话的数据，并隐藏没有数据的指标。如果终端没有使用 Nerd Font，请选择 Unicode 或 ASCII 图标。

## 使用 CCometixLine 预设和配色

配置器提供 `cometix`、`minimal`、`dashboard`、`budget`、`cache-aware`、`focus`、`zen` 和 `powerline`，以及上游全部 13 套配色。原有配色仍可选择，版本 1 保存的 `focus` 配置会迁移为 `focus-legacy`。

在仓库根目录预览 256 色 Dashboard。

```sh
node bin/agy-cli-statusline.mjs preview --preset dashboard --color-depth 256
```

色深可选自动、真彩色、256 色、16 色和无色。自动模式读取 `COLORTERM` 和 `TERM`，`zen` 默认无色。状态栏使用 agy 提供的模型、上下文、额度、费用和缓存令牌数据。Claude Code 更新、压缩阈值、上下文趋势和缓存到期时间等缺失指标会省略。五小时和七天额度分段需要 agy 提供可识别的配额窗口。

CCometixLine 的来源和许可证见[第三方声明](./THIRD_PARTY_NOTICES.md)。
