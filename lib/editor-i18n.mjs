const EN = {
  replaceTitle: "Replace the current status line?",
  emptyCommand: "(empty)",
  replaceYes: "  y replaces it and backs up settings.json",
  replaceNo: "  n or esc keeps it",
  replaceKeys: "y replace · n/esc keep",
  needsTTY: "the editor needs a TTY; on a pipe, run configure --show or configure with flags",
  title: "Status Line Studio",
  shortTitle: "Studio",
  sample: "Sample data. Nothing here is your live session.",
  noSegments: "no visible segments",
  fields: { preset: "preset", theme: "theme", skin: "skin", icons: "icons", colorDepth: "color depth", segments: "segments" },
  depths: { auto: "auto", truecolor: "truecolor", 256: "256 colors", 16: "16 colors", none: "none" },
  off: "off",
  segmentKeys: "Segments  space toggle   K/J reorder   arrows change",
  help: [
    "left/right or h/l change the selected field",
    "up/down or j/k move between fields",
    "on Segments: space enables, K/J moves the selected row",
    "enter writes preferences and installs; q or esc cancels",
  ],
  shortMove: "j/k field  h/l change",
  shortSegment: "space toggle  K/J move",
  shortHelp: "h/l selects a segment; space toggles it",
  shortFooter: "enter save  esc cancel  ?",
  footer: "enter save    q or esc cancel    ? help",
  helpFooter: "j/k field · h/l value · space toggle · K/J reorder",
  saveError: (message) => message,
};

const ZH = {
  replaceTitle: "替换当前状态栏？",
  emptyCommand: "（空）",
  replaceYes: "  y 替换并备份 settings.json",
  replaceNo: "  n 或 Esc 保留现有状态栏",
  replaceKeys: "y 替换 · n/Esc 保留",
  needsTTY: "编辑器需要交互式终端；使用管道时，请运行 configure --show 或为 configure 指定选项",
  title: "状态栏工作室",
  shortTitle: "状态栏",
  sample: "此处仅显示示例数据。",
  noSegments: "没有可显示的区块",
  fields: { preset: "预设", theme: "配色", skin: "样式", icons: "图标", colorDepth: "色深", segments: "区块" },
  depths: { auto: "自动", truecolor: "真彩色", 256: "256 色", 16: "16 色", none: "无色" },
  off: "关闭",
  segmentKeys: "区块  空格开关   K/J 调序   方向键切换",
  help: [
    "←/→ 或 h/l 更改当前选项",
    "↑/↓ 或 j/k 上下切换设置项",
    "在区块设置中，空格开关区块，K/J 调整显示顺序",
    "Enter 写入设置并安装，q 或 Esc 取消",
  ],
  shortMove: "j/k 切换  h/l 更改",
  shortSegment: "空格开关  K/J 调序",
  shortHelp: "h/l 选择区块，空格开关",
  shortFooter: "Enter 保存  Esc 取消  ?",
  footer: "Enter 保存    q 或 Esc 取消    ? 帮助",
  helpFooter: "j/k 切换设置 · h/l 改值 · 空格开关 · K/J 调序",
  saveError: (message) => `保存失败：${message}`,
};

const CHINESE_SEGMENTS = {
  model: ["模型", "显示名称、ID、推理强度"],
  dir: ["目录", "工作区目录"],
  git: ["Git", "分支、未提交更改、领先/落后提交数"],
  context: ["上下文", "上下文窗口用量"],
  quota: ["配额", "有配额数据时显示"],
  cost: ["费用", "有费用数据时显示"],
  state: ["代理", "代理当前状态"],
  cycle: ["循环", "循环模式"],
  sandbox: ["沙箱", "沙箱是否启用"],
  vcs: ["版本控制", "版本控制系统类型"],
  cache: ["缓存", "缓存令牌用量"],
  "quota.5h": ["5 小时配额", "5 小时窗口已用额度"],
  "quota.7d": ["7 天配额", "7 天窗口已用额度"],
  "quota.eta": ["配额耗尽时间", "按当前消耗速度估算"],
  worktree: ["工作树", "Git 工作树名称"],
  changes: ["变更", "变更统计"],
  age: ["会话时长", "自会话开始后经过的时间"],
  lines: ["行数", "新增和删除的行数"],
  duration: ["耗时", "运行所用时间"],
  pr: ["拉取请求", "关联的拉取请求"],
};

export function editorStrings(language) {
  return language === "zh" ? ZH : EN;
}

export function segmentText(segment, language) {
  const localized = language === "zh" && Object.hasOwn(CHINESE_SEGMENTS, segment.id)
    ? CHINESE_SEGMENTS[segment.id]
    : null;
  return localized ?? [segment.label ?? segment.id, segment.hint ?? ""];
}
