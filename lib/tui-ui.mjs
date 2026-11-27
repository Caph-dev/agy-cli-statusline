import { colorDepth, fitAnsi, paint, stripAnsi, visibleWidth } from "./ansi.mjs";
import { THEMES } from "./preferences.mjs";

export const RESET = "\x1b[0m";
export const ACCENT = "\x1b[36m";
export const MUTED = "\x1b[90m";
export const OK = "\x1b[32m";
export const WARN = "\x1b[33m";
export const BAD = "\x1b[31m";
export const BOLD = "\x1b[1m";
export const TAB_ON = "\x1b[1;7;36m";
export const TAB_CURRENT = "\x1b[1;7m";

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
      parts.push(`${ACCENT}${key}${RESET} ${desc}`);
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

export function choiceChip(value) {
  return `${ACCENT}‹${value}›${RESET}`;
}

export function radioMark(on) {
  return on ? "●" : "○";
}

export function plainWidth(text) {
  return stripAnsi(text).length;
}
