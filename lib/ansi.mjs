/**
 * ANSI helpers. Colors are named so themes stay data, not escape strings.
 * Output never emits cursor, clear, or OSC sequences; those are stripped
 * from inbound text before it can reach the terminal.
 */

const COLORS = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

export function color(name, text, { background = false, enabled = true } = {}) {
  if (!enabled || text === "" || text == null) return text ?? "";
  const code = COLORS[name];
  if (code == null) return String(text);
  const applied = background ? code + 10 : code;
  return `\x1b[${applied}m${text}\x1b[0m`;
}

export function paint(foreground, background, text, enabled = true) {
  if (!enabled || text === "" || text == null) return text ?? "";
  const fg = COLORS[foreground];
  const bg = COLORS[background];
  if (fg == null || bg == null) return String(text);
  return `\x1b[${fg};${bg + 10}m${text}\x1b[0m`;
}

/** Visible width. ANSI and C1 controls do not count; wide glyphs count as 2. */
export function visibleWidth(value) {
  const plain = stripAnsi(String(value ?? ""));
  let width = 0;
  for (const char of plain) {
    const code = char.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    width += isWide(code) ? 2 : 1;
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
    const code = char.codePointAt(0);
    const size = isWide(code) ? 2 : 1;
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
