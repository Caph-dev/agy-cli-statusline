/**
 * ANSI helpers. Colors are named so themes stay data, not escape strings.
 * Output never emits cursor, clear, or OSC sequences; those are stripped
 * from inbound text before it can reach the terminal.
 */

const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const ANSI16_RGB = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
const LEVELS = [0, 95, 135, 175, 215, 255];

export function colorDepth(preference = "auto", { env = process.env, enabled = true } = {}) {
  if (!enabled || env.NO_COLOR) return "none";
  if (preference !== "auto") return preference;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) return "truecolor";
  if (env.TERM?.includes("256color")) return "256";
  return env.TERM === "dumb" ? "none" : "16";
}

export function color(name, text, { background = false, enabled = true, depth = "truecolor" } = {}) {
  return background ? paint(undefined, name, text, enabled ? depth : "none") : paint(name, undefined, text, enabled ? depth : "none");
}

export function paint(foreground, background, text, depth = "truecolor") {
  if (depth === "none" || depth === false || !text) return text ?? "";
  const codes = [sgr(foreground, depth, false), sgr(background, depth, true)].filter(Boolean);
  return codes.length ? `\x1b[${codes.join(";")}m${text}\x1b[0m` : text;
}

function sgr(value, depth, background) {
  if (typeof value !== "string") return null;
  const indexed = /^(16|256):(\d+)$/.exec(value);
  const named = value.toLowerCase().replace(/[-_ ]/g, "");
  const bright = named.startsWith("bright");
  const base = NAMES.indexOf(bright ? named.slice(6) : named);
  const slot = indexed?.[1] === "16" ? Number(indexed[2]) : base < 0 ? -1 : base + (bright ? 8 : 0);
  if (slot >= 0 && slot < 16) return String((background ? 40 : 30) + (slot >= 8 ? 52 : 0) + slot);

  const index = indexed?.[1] === "256" ? Number(indexed[2]) : -1;
  const hasIndex = index >= 0 && index <= 255;
  const rgb = hasIndex ? indexedRgb(index) : colorRgb(value);
  if (!rgb) return null;
  if (depth === "16") return sgr(`16:${nearest(rgb, ANSI16_RGB)}`, depth, background);
  const prefix = background ? 48 : 38;
  if (depth === "256" || hasIndex) return `${prefix};5;${hasIndex ? index : to256(rgb)}`;
  return `${prefix};2;${rgb.join(";")}`;
}

export function colorRgb(value) {
  if (typeof value !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  const hex = value.length === 4 ? [...value.slice(1)].map(char => char.repeat(2)).join("") : value.slice(1);
  return hex.match(/../g).map(pair => Number.parseInt(pair, 16));
}

function indexedRgb(index) {
  if (index < 16) return ANSI16_RGB[index];
  if (index >= 232) return Array(3).fill(8 + (index - 232) * 10);
  const cube = index - 16;
  return [LEVELS[Math.floor(cube / 36)], LEVELS[Math.floor(cube / 6) % 6], LEVELS[cube % 6]];
}

function distance(first, second) {
  return first.reduce((sum, value, index) => sum + (value - second[index]) ** 2, 0);
}

function nearest(rgb, table) {
  let index = 0;
  for (let candidate = 1; candidate < table.length; candidate += 1) {
    if (distance(rgb, table[candidate]) < distance(rgb, table[index])) index = candidate;
  }
  return index;
}

function to256(rgb) {
  const [r, g, b] = rgb.map(value => nearest([value], LEVELS.map(level => [level])));
  const cube = 16 + 36 * r + 6 * g + b;
  const average = Math.floor((rgb[0] + rgb[1] + rgb[2]) / 3);
  const gray = 232 + Math.max(0, Math.min(23, Math.floor((average - 8) / 10)));
  return distance(rgb, indexedRgb(gray)) < distance(rgb, indexedRgb(cube)) ? gray : cube;
}

/** Visible width. ANSI and C1 controls do not count; wide glyphs count as 2. */
export function visibleWidth(value) {
  const plain = stripAnsi(String(value ?? ""));
  let width = 0;
  for (const char of plain) {
    const code = char.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    width += cellWidth(char);
  }
  return width;
}

export function stripAnsi(value) {
  return String(value ?? "").replace(
    /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-Z\\-_])/g,
    "",
  );
}

/** Drop terminal controls from untrusted payload text. Keeps printable chars. */
export function sanitizeText(value) {
  let text = String(value ?? "");
  text = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "");
  text = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  text = text.replace(/\x1b[@-Z\\-_]/g, "");
  text = text.replace(/[\x09-\x0d\u2028\u2029]/g, " ");
  text = text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
  return text;
}

export function truncateVisible(value, max) {
  const text = sanitizeText(value);
  if (max <= 0) return "";
  let width = 0;
  let out = "";
  for (const char of text) {
    const size = cellWidth(char);
    if (width + size > max) break;
    out += char;
    width += size;
  }
  return out;
}

export function padVisible(value, width) {
  const gap = width - visibleWidth(value);
  return gap > 0 ? value + " ".repeat(gap) : value;
}

const ANSI_TOKEN_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Clip text containing ANSI escapes to at most `max` visible cells. */
export function clipAnsi(value, max, { ellipsis = false } = {}) {
  const text = String(value ?? "");
  if (max <= 0) return "";
  if (visibleWidth(text) <= max) return text;
  const budget = ellipsis && max > 1 ? max - 1 : max;
  let width = 0;
  let out = "";
  let hasEscape = false;
  let lastIndex = 0;
  let truncated = false;
  ANSI_TOKEN_RE.lastIndex = 0;

  const consumePlain = (chunk) => {
    for (const char of chunk) {
      const code = char.codePointAt(0);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
      const size = cellWidth(char);
      if (width + size > budget) {
        truncated = true;
        return false;
      }
      out += char;
      width += size;
    }
    return true;
  };

  let match;
  while ((match = ANSI_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      if (!consumePlain(text.slice(lastIndex, match.index))) break;
    }
    out += match[0];
    hasEscape = true;
    lastIndex = ANSI_TOKEN_RE.lastIndex;
  }
  if (!truncated && lastIndex < text.length) {
    consumePlain(text.slice(lastIndex));
  }
  if (hasEscape) out += "\x1b[0m";
  if (truncated && ellipsis && max > 1) out += "\x1b[90m…\x1b[0m";
  return out;
}

/** Clip and right-pad ANSI text to exact `width` visible cells, preventing style bleed. */
export function fitAnsi(value, width, { ellipsis = false } = {}) {
  if (width <= 0) return "";
  let clipped = clipAnsi(value, width, { ellipsis });
  if (clipped.includes("\x1b") && !clipped.endsWith("\x1b[0m")) {
    clipped += "\x1b[0m";
  }
  const gap = width - visibleWidth(clipped);
  return gap > 0 ? clipped + " ".repeat(gap) : clipped;
}

function cellWidth(char) {
  return /[\p{Mark}\p{Cf}]/u.test(char) ? 0 : isWide(char.codePointAt(0)) ? 2 : 1;
}

function isWide(code) {
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) return true;
  // Powerline private-use glyphs and the Nerd Font set are double-width
  // in the terminals this status line is drawn for. Treating them as one
  // column lets a fitted row spill past the reported terminal width.
  if (code >= 0xe0a0 && code <= 0xe0d4) return true;
  if (code >= 0xe000 && code <= 0xf8ff) return true;
  if (code >= 0xf0000 && code <= 0xffffd) return true;
  return false;
}
