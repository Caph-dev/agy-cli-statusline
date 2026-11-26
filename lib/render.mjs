import { colorDepth, colorRgb, paint, sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
import { ICON_SETS, PRESETS, THEMES, presetRows } from "./preferences.mjs";
import { compactCount } from "./segments.mjs";

const CHEVRON = "\ue0b0";
const CHEVRON_LEFT = "\ue0b2";
const SEPARATORS = { plain: " · ", compact: " | ", bracket: " ", pill: " " };
const CATEGORY = {
  model: "identity", dir: "workspace", git: "vcs", vcs: "vcs", worktree: "vcs",
  context: "context", quota: "quota", "quota.5h": "quota", "quota.7d": "quota", "quota.eta": "quota",
  cache: "cache", cost: "cost", state: "activity", cycle: "session", sandbox: "system",
};
const UPSTREAM_ICONS = {
  model: ["\uef23", "◆"], dir: ["\u{f024b}", "▣"], git: ["\u{f02a2}", "⎇"],
  context: ["\uf49b", "◔"], quota: ["\u{f0520}", "◷"], "quota.eta": ["\uf252", "⇥"],
  cache: ["\uf1c0", "≈"], cost: ["\ueec1", "$"], worktree: ["\uf1bb", "⑂"],
};
const BARS = {
  eighths: [" ▏▎▍▌▋▊▉█", " "], blocks: [" █", "░"], shapes: [" ▰", "▱"],
  dots: [" ●", "○"], braille: [" ⣿", "⣀"], ascii: [" =", "-"],
};

export function renderLine(segments, preferences, { width = 0, color = true, env = process.env } = {}) {
  const options = {
    skin: preferences.skin,
    icons: preferences.icons,
    palette: THEMES[preferences.theme] ?? THEMES.dusk,
    depth: colorDepth(preferences.colorDepth, { env, enabled: color }),
    native: Boolean(PRESETS[preferences.preset]?.rows),
    separator: preferences.skin === "plain" ? PRESETS[preferences.preset]?.separator : undefined,
    contextFormat: preferences.contextFormat ?? "auto",
  };
  const values = new Map(segments.map(segment => [segment.id, segment]));
  const indices = new Map(segments.map((segment, index) => [segment.id, index]));
  const columns = Number.isFinite(width) && width > 0 ? Math.min(1000, Math.floor(width)) : 0;
  const rows = presetRows(preferences);
  const make = item => {
    const value = values.get(item.metric);
    return value && formatItem(item, value, indices.get(item.metric), options);
  };
  return rows.flatMap(row => {
    const left = row.left.map(make).filter(Boolean);
    const right = row.right.map(make).filter(Boolean);
    return options.native ? fitRows(left, right, columns, options) : [fitLegacy(left, columns, options)];
  }).filter(Boolean).join("\n");
}

function formatItem(item, segment, index, theme) {
  const category = CATEGORY[segment.id];
  const palette = theme.palette;
  const slot = palette.slots?.[index % palette.slots.length];
  const colors = palette.colors;
  const categoryColor = colors?.[category] ?? slot;
  const foreground = { bad: colors?.crit ?? "red", warn: colors?.warn ?? "yellow", muted: colors?.muted ?? palette.muted }[segment.tone] ?? categoryColor;
  const explicitFill = palette.segments?.[category];
  const filled = theme.skin === "powerline" || theme.skin === "pill";
  const background = explicitFill?.[0] ?? categoryColor;
  const fillText = explicitFill?.[1] ?? readableInk(background, colors?.onfill ?? palette.text);
  let icon = iconFor(item, segment.id, theme);
  let graph = "";
  const glyphs = ICON_SETS[theme.icons];
  let text = sanitizeText(segment.text);
  if (segment.git) {
    const marks = [segment.dirty && glyphs.dirty, segment.gitAhead && glyphs.ahead, segment.gitBehind && glyphs.behind].filter(Boolean);
    if (marks.length) text += ` ${marks.join("")}`;
  }
  const widget = item.widget ?? (segment.id === "context" ? (theme.native ? "bar" : "legacy-bar")
    : segment.id.startsWith("quota.") ? "pace" : "text");
  if (segment.id === "cache" && theme.icons === "ascii") text = text.replaceAll(" · ", " / ");
  if (typeof segment.gauge === "number") {
    if (segment.id === "context") {
      text = formatContextText(text, item, segment, theme);
    }
    const cells = item.cells ?? (theme.native ? 8 : 5);
    const barStyle = theme.icons === "ascii" ? "ascii" : item.bar ?? (theme.native ? "shapes" : "blocks");
    if (widget === "gauge" && theme.icons !== "ascii") {
      icon = gaugeIcon(segment.gauge, theme.icons);
    } else if (widget === "bar") {
      graph = renderBar(segment.gauge, cells, barStyle, item.coloring, theme, filled ? background : undefined, filled ? fillText : foreground);
    } else if (widget === "legacy-bar") {
      const filledCells = Math.round(segment.gauge * cells / 100);
      const [mark, empty] = theme.icons === "ascii" ? ["#", "-"] : ["█", "░"];
      text += ` ${mark.repeat(filledCells)}${empty.repeat(cells - filledCells)}`;
    } else if (widget === "pace" && segment.pace != null) {
      const delta = Math.round(segment.gauge - segment.pace);
      const direction = delta > 0 ? (theme.icons === "ascii" ? "+" : "⇡") : delta < 0 ? (theme.icons === "ascii" ? "-" : "⇣") : "±";
      text += ` ${direction}${Math.abs(delta)}%`;
      if (theme.icons !== "ascii" && theme.depth !== "none") {
        graph = renderPace(segment.gauge, segment.pace, cells, colors, foreground, theme.depth);
      }
    }
  }
  return {
    icon, graph, text,
    iconColor: item.icon_color ?? (filled ? fillText : categoryColor),
    foreground: filled ? fillText : foreground,
    background: filled ? background : undefined,
  };
}

function formatContextText(base, item, segment, theme) {
  const prefix = item.format?.startsWith("ctx ") ? "ctx " : "";
  const format = theme.contextFormat ?? "auto";
  if (format === "percent") return `${prefix}${base}`;
  if (format === "tokens") {
    const suffix = segment.tokens > 0 ? ` · ${compactCount(segment.tokens)}` : "";
    return `${prefix}${base}${suffix}`;
  }
  if (format === "ratio") {
    if (segment.tokens != null && segment.size > 0) {
      return `${prefix}${base} · ${compactCount(segment.tokens)}/${compactCount(segment.size)}`;
    }
    const suffix = segment.tokens > 0 ? ` · ${compactCount(segment.tokens)}` : "";
    return `${prefix}${base}${suffix}`;
  }
  if (item.format?.includes("{tokens}") && segment.tokens > 0) {
    return `${prefix}${base} · ${compactCount(segment.tokens)} tokens`;
  }
  if (theme.native && !item.format && segment.tokens > 0) {
    return `${prefix}${base} · ${compactCount(segment.tokens)}`;
  }
  return `${prefix}${base}`;
}

function iconFor(item, id, { icons, native }) {
  if (item.icon != null) return item.icon;
  if (native) {
    if (icons === "none" || icons === "ascii") return "";
    const entry = UPSTREAM_ICONS[id] ?? (id.startsWith("quota.") ? UPSTREAM_ICONS.quota : undefined);
    if (entry) return entry[icons === "nerd" ? 0 : 1];
  }
  return ICON_SETS[icons]?.[id] ?? "";
}

function gaugeIcon(pct, icons) {
  const steps = icons === "nerd" ? 8 : 5;
  const index = Math.min(steps - 1, Math.floor(pct / 100 * steps));
  return icons === "nerd" ? String.fromCodePoint(0xf0a9e + index) : "○◔◑◕●"[index];
}

function bar(pct, cells, style) {
  const [steps, empty] = BARS[style] ?? BARS.shapes;
  return Array.from({ length: cells }, (_, i) => {
    const amount = pct / 100 * cells - i;
    if (amount >= 1) return steps.at(-1);
    if (amount > 0 && style === "eighths") return steps[Math.max(1, Math.round(amount * 8))];
    return empty;
  });
}

function renderBar(pct, cells, style, coloring, theme, background, foreground) {
  const frame = style === "eighths" ? ["▕", "▏"] : style === "ascii" ? ["[", "]"] : ["", ""];
  const muted = theme.palette.colors?.muted ?? theme.palette.muted;
  const draw = (text, color) => paint(color, background, text, theme.depth);
  const parts = bar(pct, cells, style).map((cell, index) => {
    const empty = (BARS[style] ?? BARS.shapes)[1];
    const color = cell === empty ? muted
      : coloring === "gradient" ? gradient(theme.palette.colors, (index + 0.5) / cells) ?? foreground : foreground;
    return draw(cell, color);
  });
  return draw(frame[0], muted) + parts.join("") + draw(frame[1], muted);
}

function renderPace(used, elapsed, cells, colors, fill, depth) {
  const muted = colors?.muted ?? "brightBlack";
  const passed = mix(muted, colors?.text, 0.5) ?? "16:7";
  return Array.from({ length: cells }, (_, i) => paint(
    i < Math.round(used * cells / 100) ? fill : muted,
    i < Math.round(elapsed * cells / 100) ? passed : muted,
    "▀", depth,
  )).join("");
}

function gradient(colors, value) {
  if (!colors) return undefined;
  const [first, last, ratio] = value < 0.5 ? [colors.ok, colors.warn, 2 * value] : [colors.warn, colors.crit, 2 * value - 1];
  return mix(first, last, ratio) ?? (value < 0.5 ? colors.ok : value < 0.8 ? colors.warn : colors.crit);
}

function mix(first, last, ratio) {
  const from = colorRgb(first);
  const to = colorRgb(last);
  if (!from || !to) return undefined;
  return "#" + from.map((value, i) => Math.round(value + (to[i] - value) * ratio).toString(16).padStart(2, "0")).join("");
}

function readableInk(background, preferred) {
  if (!background) return preferred;
  const rgb = colorRgb(background);
  if (!rgb) return preferred;
  const luminance = rgb.reduce((sum, value, i) => {
    const x = value / 255;
    return sum + [0.2126, 0.7152, 0.0722][i] * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  }, 0);
  return luminance >= 0.18 ? "#111111" : "#f5f5f5";
}

function fitLegacy(items, width, options) {
  if (!width) return compose(items, options);
  const kept = [...items];
  while (kept.length > 1 && visibleWidth(compose(kept, options)) > width) kept.pop();
  return renderBounded(kept, width, options);
}

function fitRows(left, right, width, options) {
  if (!width) return [joinSides(left, right, 0, options)];
  const combined = joinSides(left, right, width, options);
  if (visibleWidth(combined) <= width) return [combined];
  const wrap = (items, side) => {
    const groups = [];
    let group = [];
    for (const item of items) {
      if (group.length && visibleWidth(compose([...group, item], options, side)) > width) {
        groups.push(renderBounded(group, width, options, side));
        group = [];
      }
      group.push(item);
    }
    if (group.length) groups.push(renderBounded(group, width, options, side));
    return groups;
  };
  const leftRows = wrap(left, "left");
  const rightRows = wrap(right, "right").filter(Boolean);
  return [...leftRows, ...rightRows.map(line => " ".repeat(width - visibleWidth(line)) + line)];
}

function joinSides(left, right, width, options) {
  const first = compose(left, options);
  const last = compose(right, options, "right");
  if (!last) return first;
  const minimum = first ? 1 : 0;
  const gap = Math.max(minimum, width - visibleWidth(first) - visibleWidth(last));
  return first + " ".repeat(gap) + last;
}

function renderBounded(items, width, options, side) {
  const rendered = compose(items, options, side);
  if (visibleWidth(rendered) <= width) return rendered;
  const first = items[0];
  if (!first) return "";
  if (first.graph) {
    const compact = compose([{ ...first, graph: "" }], options, side);
    if (visibleWidth(compact) <= width) return compact;
  }
  const textOnly = { ...first, icon: "", graph: "", text: "" };
  const frameWidth = visibleWidth(compose([textOnly], options, side));
  if (width <= frameWidth) return truncateVisible(first.text, width);
  return compose([{ ...textOnly, text: truncateVisible(first.text, width - frameWidth) }], options, side);
}

function compose(items, { skin, depth, palette, separator, icons, native }, side = "left") {
  if (!items.length) return "";
  const style = (foreground, background, text) => paint(foreground, background, text, depth);
  const sepColor = palette.colors?.separator;
  const body = item => {
    const { foreground, background, icon, text, iconColor, graph } = item;
    return [style(iconColor, background, icon), graph, style(foreground, background, text)]
      .filter(Boolean).join(style(undefined, background, " "));
  };
  if (skin === "bracket") return items.map(item => style(sepColor, undefined, "[") + body(item) + style(sepColor, undefined, "]")).join(" ");
  if (skin !== "powerline" && skin !== "pill") {
    const joiner = separator ?? (icons === "ascii" ? " | " : native ? " │ " : SEPARATORS[skin]);
    return items.map(body).join(style(sepColor, undefined, joiner));
  }
  const ascii = icons === "ascii";
  const leftEdge = ascii ? "<" : icons === "nerd" ? CHEVRON_LEFT : "◂";
  const rightEdge = ascii ? ">" : icons === "nerd" ? CHEVRON : "▸";
  return items.map((item, index) => {
    const space = style(undefined, item.background, " ");
    const contents = space + body(item) + space;
    if (skin === "pill") {
      return style(item.background, undefined, ascii ? "(" : "\ue0b6") + contents + style(item.background, undefined, ascii ? ")" : "\ue0b4");
    }
    if (side === "right") {
      return style(item.background, items[index - 1]?.background, leftEdge) + contents;
    }
    return contents + style(item.background, items[index + 1]?.background, rightEdge);
  }).join(skin === "pill" ? " " : "");
}

export function renderPlain(segments, preferences, options = {}) {
  return renderLine(segments, preferences, { ...options, color: false });
}
