import { colorDepth, fitAnsi, padVisible, paint, stripAnsi, visibleWidth } from "./ansi.mjs";
import { THEMES } from "./preferences.mjs";

export const RESET = "\x1b[0m";
export const ACCENT = "\x1b[36m";
export const MUTED = "\x1b[90m";
export const OK = "\x1b[32m";
export const WARN = "\x1b[33m";
export const BAD = "\x1b[31m";
export const BLUE = "\x1b[94m";
export const MAGENTA = "\x1b[35m";
export const BOLD = "\x1b[1m";
export const TAB_ON = "\x1b[1;7;36m";
export const TAB_CURRENT = "\x1b[1;7m";

const KEY_GROUPS = [
  ["\x1b[1;32m", ["enter", "Enter", "^S", "y"]],
  ["\x1b[1;36m", ["←→", "↑↓", "←→↑↓", "↑", "↓", "←/→", "↑/↓", "tab", "Tab", "[ ]", "[ / ]", "1–2"]],
  ["\x1b[1;33m", ["e", "b", "a", "m", "L", "N", "space", "空格", "- +", "- / +", "type", "输入"]],
  ["\x1b[1;35m", ["S", "W", "E", "r", "^Z", "^Y", "^Z / ^Y", "{ }", "{ / }"]],
  ["\x1b[1;94m", ["^P", "?"]],
  ["\x1b[1;31m", ["X", "q", "esc", "Esc", "bksp", "Bksp", "n"]],
];
const KEY_COLOR_MAP = new Map(KEY_GROUPS.flatMap(([code, keys]) => keys.map((key) => [key, code])));

export function styleKey(key) {
  const code = KEY_COLOR_MAP.get(key) ?? "\x1b[1;36m";
  return `${code}${key}${RESET}`;
}

export function styleMagenta(text) {
  return `${MAGENTA}${text}${RESET}`;
}

export function styleBlue(text) {
  return `${BLUE}${text}${RESET}`;
}

const RAINBOW_RGB = [
  "#eb5f57",
  "#f58b57",
  "#fac35f",
  "#91c882",
  "#82aadC",
  "#9b82c8",
  "#c882b4",
];
const RAINBOW_ANSI = ["red", "brightRed", "yellow", "green", "cyan", "blue", "magenta"];

export function styleAccent(text) {
  return `${ACCENT}${text}${RESET}`;
}

export function styleMuted(text) {
  return `${MUTED}${text}${RESET}`;
}

export function styleOk(text) {
  return `${OK}${text}${RESET}`;
}

export function styleWarn(text) {
  return `${WARN}${text}${RESET}`;
}

export function styleBad(text) {
  return `${BAD}${text}${RESET}`;
}

export function styleBold(text) {
  return `${BOLD}${text}${RESET}`;
}

export function renderBrand(text = "agy-statusline", depth = "truecolor") {
  if (depth === "none") return text;
  const palette = depth === "truecolor" || depth === "256" ? RAINBOW_RGB : RAINBOW_ANSI;
  return [...text]
    .map((ch, i) => `${BOLD}${paint(palette[i % palette.length], undefined, ch, depth)}`)
    .join("");
}

export function drawTopBorder(columns, rightTitle = "") {
  const inner = Math.max(0, columns - 2);
  if (!rightTitle) {
    return `${MUTED}┌${"─".repeat(inner)}┐${RESET}`;
  }
  const titleWidth = visibleWidth(rightTitle);
  if (titleWidth + 2 >= inner) {
    return `${MUTED}┌${"─".repeat(inner)}┐${RESET}`;
  }
  const leftFill = inner - titleWidth - 1;
  return `${MUTED}┌${"─".repeat(leftFill)}${RESET}${rightTitle}${MUTED}─┐${RESET}`;
}

export function drawBottomBorder(columns) {
  const inner = Math.max(0, columns - 2);
  return `${MUTED}└${"─".repeat(inner)}┘${RESET}`;
}

export function drawRule(columns, titleAnsi = "") {
  const inner = Math.max(0, columns - 2);
  if (!titleAnsi) {
    return `${MUTED}├${"─".repeat(inner)}┤${RESET}`;
  }
  const left = 1;
  const maxTitle = Math.max(0, inner - left - 1);
  const clippedTitle = fitAnsi(titleAnsi, Math.min(visibleWidth(titleAnsi), maxTitle), { ellipsis: true });
  const titleW = visibleWidth(clippedTitle);
  const right = Math.max(0, inner - left - titleW);
  return `${MUTED}├${"─".repeat(left)}${RESET}${clippedTitle}${MUTED}${"─".repeat(right)}┤${RESET}`;
}

export function frameRow(innerAnsi, innerWidth, columns) {
  const fitted = fitAnsi(innerAnsi, innerWidth, { ellipsis: true });
  return `${MUTED}│${RESET}${fitted}\x1b[${columns}G${MUTED}│${RESET}`;
}

export function formatHints(own = [], global = [], width = 80) {
  const render = (items) => {
    const parts = [" "];
    items.forEach(([key, desc], index) => {
      if (index > 0) parts.push("   ");
      parts.push(`${styleKey(key)} ${desc}`);
    });
    parts.push(" ");
    return parts.join("");
  };

  const ownCopy = own.slice();
  const globalCopy = global.slice();
  while (true) {
    const combined = [...ownCopy, ...globalCopy];
    const line = render(combined);
    if (visibleWidth(line) <= width) return line;
    const dropOrder = ["q", "^P", "^S", "↑"];
    const dropIndex = dropOrder.reduce((found, key) => {
      if (found >= 0) return found;
      return globalCopy.findIndex(([k]) => k === key);
    }, -1);
    if (dropIndex >= 0) {
      globalCopy.splice(dropIndex, 1);
    } else if (ownCopy.length > 0) {
      ownCopy.pop();
    } else {
      return fitAnsi(line, width, { ellipsis: true });
    }
  }
}

export function formatKeyStrip(pairs = [], maxWidth = 80) {
  const shown = pairs.slice();
  while (shown.length > 0) {
    const line = " " + shown.map(([key, desc]) => `${styleKey(key)} ${desc}`).join("   ");
    if (visibleWidth(line) <= maxWidth) return line;
    shown.pop();
  }
  return "";
}

export function renderPanel(titleAnsi, bodyLines, width, height, {
  borderColor = MUTED,
  rightTitleAnsi = "",
  startCol = 2,
} = {}) {
  const w = Math.max(4, width);
  const h = Math.max(2, height);
  const innerW = w - 2;
  const rightCol = startCol + w - 1;
  const snapRight = (glyph) => `\x1b[${rightCol}G${borderColor}${glyph}${RESET}`;

  const rightChunk = rightTitleAnsi
    ? fitAnsi(rightTitleAnsi, Math.min(visibleWidth(rightTitleAnsi), Math.max(0, innerW - 4)), { ellipsis: true })
    : "";
  const rightW = visibleWidth(rightChunk);
  const leftChunk = titleAnsi
    ? fitAnsi(titleAnsi, Math.min(visibleWidth(titleAnsi), Math.max(0, innerW - 2 - rightW)), { ellipsis: true })
    : "";
  const leftW = visibleWidth(leftChunk);
  const fill = Math.max(0, innerW - 1 - leftW - rightW);

  const top = `${borderColor}╭─${RESET}${leftChunk}${borderColor}${"─".repeat(fill)}${RESET}${rightChunk}${snapRight("╮")}`;
  const bottom = `${borderColor}╰${"─".repeat(innerW)}${snapRight("╯")}`;

  const bodySlots = h - 2;
  const rows = [];
  for (let i = 0; i < bodySlots; i += 1) {
    const content = bodyLines[i] ?? "";
    const fitted = fitAnsi(content, innerW, { ellipsis: true });
    rows.push(`${borderColor}│${RESET}${fitted}${snapRight("│")}`);
  }
  return [top, ...rows, bottom];
}

export function composePanels(panels, innerW, columns, bodyRows) {
  const out = [];
  for (let r = 0; r < bodyRows; r += 1) {
    let rowContent = "";
    let usedW = 0;
    for (const panel of panels) {
      if (panel.offset > usedW) {
        rowContent += " ".repeat(panel.offset - usedW);
        usedW = panel.offset;
      }
      const startCol = 2 + panel.offset;
      rowContent += `\x1b[${startCol}G${panel.lines[r] ?? ""}`;
      usedW = panel.offset + panel.width;
    }
    if (innerW > usedW) rowContent += " ".repeat(innerW - usedW);
    out.push(`${MUTED}│${RESET}${rowContent}\x1b[${columns}G${MUTED}│${RESET}`);
  }
  return out;
}

const PALETTE_SWATCH_KEYS = [
  ["identity", 0],
  ["workspace", 1],
  ["vcs", 2],
  ["context", 3],
  ["quota", 4],
  ["cost", 5],
  ["cache", 6],
  ["ok", 0],
  ["warn", 1],
  ["crit", 2],
];

export function renderPaletteGrid(themeName, labels, depth = colorDepth("auto"), width = 40) {
  const theme = THEMES[themeName];
  if (!theme) return [];
  const colW = Math.max(12, Math.floor((width - 2) / 2));
  const showHex = colW >= 18;
  const resolveColor = (key, slotIdx) => {
    if (theme.colors?.[key]) return theme.colors[key];
    if (key === "ok" || key === "warn" || key === "crit") return theme.gauge?.[slotIdx] ?? "white";
    return theme.slots?.[slotIdx % (theme.slots?.length || 1)] ?? "white";
  };
  const cell = ([key, slotIdx]) => {
    const color = resolveColor(key, slotIdx);
    const swatch = depth === "none" ? "□" : paint(color, undefined, "■", depth);
    const name = labels[key] ?? key;
    const hex = showHex ? ` ${MUTED}${color}${RESET}` : "";
    return padVisible(` ${swatch} ${name}${hex}`, colW);
  };
  const rows = [];
  for (let i = 0; i < PALETTE_SWATCH_KEYS.length; i += 2) {
    const left = cell(PALETTE_SWATCH_KEYS[i]);
    const right = PALETTE_SWATCH_KEYS[i + 1] ? cell(PALETTE_SWATCH_KEYS[i + 1]) : "";
    rows.push(`${left} ${right}`);
  }
  return rows;
}

export function renderThemeSwatches(themeName, depth = colorDepth("auto")) {
  const theme = THEMES[themeName];
  if (!theme || depth === "none") return "";
  const colors = theme.colors
    ? ["identity", "workspace", "vcs", "context", "quota", "cost", "cache", "activity"]
      .map((k) => theme.colors[k])
      .filter(Boolean)
    : (theme.slots ?? []).slice(0, 6);
  return colors.slice(0, 6).map((c) => paint(c, undefined, "■", depth)).join(" ");
}

export function buildPopupOverlay(columns, rows, titleText, bodyLines, { width = 56, borderColor = ACCENT } = {}) {
  const boxW = Math.max(24, Math.min(width, columns - 4));
  const innerW = boxW - 2;
  const maxBodyRows = Math.max(1, rows - 4);
  const shownBody = bodyLines.slice(0, maxBodyRows);
  const boxH = shownBody.length + 2;
  const startCol = Math.max(1, Math.floor((columns - boxW) / 2) + 1);
  const startRow = Math.max(1, Math.floor((rows - boxH) / 2) + 1);

  const titleChunk = titleText ? ` ${titleText} ` : "";
  const titleFitted = titleChunk ? fitAnsi(titleChunk, Math.min(visibleWidth(titleChunk), Math.max(0, innerW - 2))) : "";
  const titleW = visibleWidth(titleFitted);
  const topFill = Math.max(0, innerW - 1 - titleW);

  const seq = [];
  seq.push(
    `\x1b[${startRow};${startCol}H${borderColor}╭─${RESET}${BOLD}${titleFitted}${RESET}${borderColor}${"─".repeat(topFill)}╮${RESET}`,
  );
  shownBody.forEach((line, idx) => {
    const r = startRow + 1 + idx;
    const fitted = fitAnsi(line, innerW, { ellipsis: true });
    seq.push(
      `\x1b[${r};${startCol}H${borderColor}│${RESET}${fitted}\x1b[${startCol + boxW - 1}G${borderColor}│${RESET}`,
    );
  });
  const bottomRow = startRow + boxH - 1;
  seq.push(
    `\x1b[${bottomRow};${startCol}H${borderColor}╰${"─".repeat(innerW)}╯${RESET}`,
  );
  return seq.join("");
}

export function choiceChip(value, color = ACCENT) {
  return `${color}‹${value}›${RESET}`;
}

export function radioMark(on) {
  return on ? "●" : "○";
}

export function plainWidth(text) {
  return stripAnsi(text).length;
}
