# agy-cli-statusline

面向 Antigravity CLI（`agy`）的可定制状态栏与终端实时预览编辑器。

![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)
![macOS | Linux](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-555555?style=flat-square)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=flat-square)

[English](./README.md) · **简体中文**

## 效果预览

![包含上下文圆环、缓存命中率、Git 变更统计、配额速率条、今日费用与子代理树的多行状态栏预览](./assets/preview-full.jpg)
*完整布局：包含上下文圆环、缓存命中率、Git 变更统计、工作树、生成速率、5h/7d 配额速率条、会话/今日费用与列对齐的子代理树。*

![较窄终端下 agy 实时会话自动折行渲染效果](./assets/preview-live.png)
*在较窄终端的 `agy` 实时会话中，超出宽度的状态栏会自动折行并保持完整样式。*

## 特性

- **实时预览 TUI 编辑器**：支持中英文切换、键盘交互排布，与 `agy` 状态栏共用同一套渲染器。
- **丰富的指标组件**：内置 18 个组件，覆盖模型、上下文圆环/进度条、提示缓存、Git 变更统计、5h/7d 配额速率、生成速率、会话与今日花费以及列对齐的子代理树。
- **预设与主题**：提供 13 套预设（8 套 CCometixLine 预设 + 5 套内置预设）、18 套配色、Nerd / Unicode / ASCII 图标，以及窄终端自动无损折行。
- **零依赖且安全安装**：无第三方运行时依赖；自动注册到 `~/.gemini/antigravity-cli/settings.json`，替换已有状态栏前会先询问并备份原配置。

## 快速开始

需要 **Node.js 22+**，以及 **macOS** 或 **Linux** 上的 **Antigravity CLI**。

### 交互式编辑器（推荐）

```sh
npx agy-cli-statusline
# 或在克隆的仓库目录运行：
node bin/agy-cli-statusline.mjs
```

选择 **English** 或 **简体中文**，在实时预览中调整预设、配色与组件，按 `Ctrl+S` 保存后重启 `agy` 即可生效。首次运行会自动注册状态栏（若检测到已有其他 `statusLine`，会先确认并备份 `settings.json`）。

### 在 `agy` 中以插件方式配置

```sh
agy plugin install https://github.com/Caph-dev/agy-cli-statusline
# 或在克隆的仓库目录安装：
agy plugin install .
```

在 `agy` 中输入 `/agy-cli-statusline-setup`，按 `Tab` 补全为 `/agy-cli-statusline:agy-cli-statusline-setup`（agy 1.5.18 要求使用完整命名空间），再告诉它想要的预设或组件即可。如果当前会话的状态栏未刷新，请重启 `agy`。

### 命令行与脚本配置

```sh
agy-cli-statusline configure --show
agy-cli-statusline configure --preset dashboard --color-depth 256
agy-cli-statusline preview --preset cometix
```

运行 `agy-cli-statusline --help` 查看全部参数；如需直接替换已有自定义状态栏，请附加 `--replace`。

> 配置与独立渲染器副本保存在 `~/.gemini/antigravity-cli/agy-cli-statusline/`，清理 npm 缓存或卸载插件后状态栏仍可正常运行。如果终端未使用 Nerd Font，可将图标切换为 `unicode` 或 `ascii`。

## 内置组件

| 组件 ID | 名称 | 简介 |
| :--- | :--- | :--- |
| `model` | 模型 | 显示当前模型名称、ID 与推理强度。 |
| `dir` | 目录 | 工作区目录路径，支持 `auto`、`name`、`parent`、`tilde`、`short`、`full` 样式。 |
| `git` | Git | 分支、短 HEAD SHA、脏状态与领先/落后提交数，支持可选改动文件数与 `+新增 -删除` 行数统计。 |
| `worktree` | 工作树 | 关联的 Git worktree 名称。 |
| `vcs` | 版本控制 | 版本控制系统类型（在 `agy` 上报时显示）。 |
| `context` | 上下文 | 上下文窗口用量；默认动态按比例填充圆环（`gauge`，≥70% 标黄、≥90% 标红），也支持 `bar` / `text` 组件与用量格式（`% · used/total`）。 |
| `cache` | 缓存 | 提示缓存暖/冷 TTL 倒计时、会话命中率（`{hit}% hit`）、未命中次数与原因、冷缓存重建估算费用；支持 `text` / `bar` / `gauge` 组件。 |
| `tps` | 生成速度 | 最近一次模型调用的生成速率（`tok/s`），支持可选首字延迟与模型中位数。 |
| `quota` | 配额 | 汇总已上报配额窗口及最近重置倒计时。 |
| `quota.5h` | 5 小时配额 | 5 小时配额窗口，支持速率差值（`⇡` / `⇣`）、重置倒计时与 `pace` / `bar` / `gauge` / `text` 组件。 |
| `quota.7d` | 7 天配额 | 7 天（每周）配额窗口，支持速率差值（`⇡` / `⇣`）、重置倒计时与 `pace` / `bar` / `gauge` / `text` 组件。 |
| `quota.eta` | 配额耗尽时间 | 按当前消耗速率估算的配额耗尽剩余时间。 |
| `cost` | 费用 | 当前会话花费（`agy` 未提供时自动回退为本机对话库估算费用）。 |
| `cost.today` | 今日费用 | 本地 0 点起按 API 标准价估算的今日累计花费及调用/对话数。 |
| `state` | 代理 | 代理当前运行状态（如 `working`、`editing`、`idle`）。 |
| `subagents` | 子代理 | 展示活跃及近期子代理的列对齐树形列表 `tree`（最多 4 行，含模型、上下文、缓存、花费与实时状态，已完成约 10 秒后收起），也可切换为单行 `inline` 汇总。 |
| `cycle` | 循环 | 代理循环模式。 |
| `sandbox` | 沙箱 | 沙箱启用状态（`on` / `off`）。 |

- 编辑器使用示例数据预览全部指标；在 `agy` 实时会话中，没有数据的组件会自动隐藏。
- 当 `agy` 未直接提供对应字段时，`cache`、`tps`、`cost.today`、`cost` 与 `subagents` 会通过只读 `node:sqlite` 读取 `~/.gemini/antigravity-cli/conversations/*.db` 进行计算。

## 自定义与快捷键

- **预设**：CCometixLine 预设（`cometix`、`minimal`、`dashboard`、`budget`、`cache-aware`、`focus`、`zen`、`powerline`）与内置预设（`studio`、`signal`、`compact`、`bracket`、`focus-legacy`）。
- **配色与外观**：13 套 CCometixLine 配色 + 5 套内置主题（`dusk`、`ink`、`paper`、`signal`、`mono`）；支持 `powerline`、`plain`、`compact`、`bracket`、`pill` 样式及 `auto`、`truecolor`、`256`、`16`、`none` 色深。
- **单区块微调**：在布局编辑器中可为每个已启用区块单独调整组件形态、Nerd Font 备选图标或自定义字符，以及 `{field}` / `[...]` 模板。

| 按键 | 功能 |
| :--- | :--- |
| `↑` / `↓`（`j` / `k`） | 在设置项或区块列表间移动 |
| `←` / `→`（`h` / `l`） | 切换当前选项值 |
| `Enter` / `空格` | 进入**区块**排布；排布内 `空格` 开关区块，`Enter` 拿起/放下调整顺序（移动中按 `Esc` 撤销） |
| `e` 或 `→` | 编辑已启用区块的组件、图标与模板（按 `r` 恢复默认） |
| `Ctrl+S` / `q` | 保存配置 / 取消退出 |

## 致谢

- [CCometixLine](https://github.com/Haleclipse/CCometixLine)（Haleclipse）—— 提供了预设方案、调色板、ANSI 色彩转换及提示缓存指标设计。
- [agy-zh-pack](https://github.com/ncdeng/agy-zh-pack)（ncdeng）—— 提供了本机 SQLite / protobuf 遥测读取、API 价格表、TPS 与今日费用估算、缓存未命中检测及多行对齐子代理树组件。

上游具体提交哈希与 MIT 许可证原文见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
