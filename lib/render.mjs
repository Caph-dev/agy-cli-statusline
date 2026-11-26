/**
 * Pure status-line renderer. The installed command and the editor preview
 * both call renderLine so a saved preference cannot drift from the preview.
 */

import { color, paint, visibleWidth, sanitizeText } from "./ansi.mjs";
import { ICON_SETS, SKINS, THEMES } from "./preferences.mjs";

const CHEVRON = "\ue0b0";
const CHEVRON_SOFT = "\u25b8";
const GAUGE_ON = "\u2588";
const GAUGE_OFF = "\u2591";

const SKIN_JOIN = {
  powerline: null,
  plain: " \u00b7 ",
  compact: " | ",
  bracket: " ",
};

export function renderLine(segments, preferences, { width = 0, color: useColor = true } = {}) {
  const theme = THEMES[preferences.theme] ?? THEMES.dusk;
  const skin = preferences.skin;
  const icons = ICON_SETS[preferences.icons] ?? ICON_SETS.unicode;
  const ascii = preferences.icons === "ascii";
  const separator = skin === "powerline"
    ? (ascii ? ">" : preferences.icons === "nerd" ? CHEVRON : CHEVRON_SOFT)
    : (ascii && skin === "plain" ? " | " : SKIN_JOIN[skin]);
  const pieces = segments.map((segment, index) =>
    renderPiece(segment, index, { theme, skin, icons, ascii, useColor }),
  );
  const fitted = fit(pieces, skin, separator, width, useColor);
  return joinPieces(fitted, skin, separator, useColor);
}

function renderPiece(segment, index, { theme, skin, icons, ascii, useColor }) {
  const slot = theme.slots[index % theme.slots.length];
  const icon = icons[segment.id] || "";
  const body = segmentBody(segment, icons, ascii);
  const inner = icon ? `${icon} ${body}` : body;
  if (skin === "bracket") {
    const text = `[${inner}]`;
    return { text: color(toneColor(segment, theme, slot), text, { enabled: useColor }), plain: text };
  }
  if (skin === "powerline") {
    const padded = ` ${inner} `;
    return {
      text: paint(theme.text, slot, padded, useColor),
      plain: padded,
      background: slot,
      foreground: theme.text,
    };
  }
  return { text: color(toneColor(segment, theme, slot), inner, { enabled: useColor }), plain: inner };
}

function segmentBody(segment, icons, ascii) {
  const text = sanitizeText(segment.text);
  if (segment.git) {
    const marks = [
      segment.dirty ? icons.dirty : icons.clean,
      segment.gitAhead ? icons.ahead : "",
      segment.gitBehind ? icons.behind : "",
    ].filter(Boolean);
    return marks.length ? `${text} ${marks.join("")}` : text;
  }
  if (typeof segment.gauge === "number") {
    return `${text} ${gaugeBar(segment.gauge, ascii)}`;
  }
  return text;
}

function gaugeBar(pct, ascii) {
  const cells = 5;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells);
  return (ascii ? "#" : GAUGE_ON).repeat(filled) + (ascii ? "-" : GAUGE_OFF).repeat(cells - filled);
}

function toneColor(segment, theme, slot) {
  if (segment.tone === "bad") return "red";
  if (segment.tone === "warn") return "yellow";
  if (segment.tone === "muted") return theme.muted;
  if (typeof segment.gauge === "number") {
    if (segment.gauge >= 90) return theme.gauge[2];
    if (segment.gauge >= 70) return theme.gauge[1];
    return theme.gauge[0];
  }
  return slot;
}

function fit(pieces, skin, separator, width, useColor) {
  if (!width || width < 1) return pieces;
  const join = visibleWidth(separator);
  const tail = skin === "powerline" ? join : 0;
  const kept = pieces.slice();
  while (kept.length > 1 && rowWidth(kept, join) + tail > width) kept.pop();
  if (kept.length === 1 && rowWidth(kept, join) + tail > width) {
    const only = kept[0];
    const plain = clip(only.plain, width - tail);
    if (!plain.trim()) return [];
    const text = only.background ? paint(only.foreground, only.background, plain, useColor) : plain;
    kept[0] = { ...only, plain, text };
  }
  return kept;
}

function joinPieces(pieces, skin, separator, useColor) {
  if (skin !== "powerline") return pieces.map((piece) => piece.text).join(separator);
  return pieces.map((piece, index) => {
    const next = pieces[index + 1];
    const edge = next
      ? paint(piece.background, next.background, separator, useColor)
      : color(piece.background, separator, { enabled: useColor });
    return piece.text + edge;
  }).join("");
}

function rowWidth(pieces, join) {
  const body = pieces.reduce((sum, piece) => sum + visibleWidth(piece.plain), 0);
  return body + join * (pieces.length - 1);
}

function clip(text, width) {
  let used = 0;
  let out = "";
  for (const char of text) {
    const size = visibleWidth(char);
    if (used + size > width) break;
    out += char;
    used += size;
  }
  return out;
}

export function renderPlain(segments, preferences, options = {}) {
  return renderLine(segments, preferences, { ...options, color: false });
}
