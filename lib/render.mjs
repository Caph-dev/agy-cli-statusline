import { colorDepth, colorRgb, paint, sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
import { ICON_SETS, PRESETS, THEMES, presetRows } from "./preferences.mjs";
import { paceArrow } from "./segments.mjs";
import { renderTemplate, templateUsesField } from "./template.mjs";

const CHEVRON = "\ue0b0";
const CHEVRON_LEFT = "\ue0b2";
const SEPARATORS = { plain: " · ", compact: " | ", bracket: " ", pill: " " };
const CATEGORY = {
  model: "identity", dir: "workspace", git: "vcs", vcs: "vcs", worktree: "vcs",
  context: "context", quota: "quota", "quota.5h": "quota", "quota.7d": "quota", "quota.eta": "quota",
  cache: "cache", cost: "cost", state: "activity", cycle: "session", sandbox: "system",
};
export const UPSTREAM_ICONS = {
  model: ["\uef23", "◆"], dir: ["\u{f024b}", "▣"], git: ["\u{f02a2}", "⎇"],
  context: ["\uf49b", "◔"], quota: ["\u{f0520}", "◷"], "quota.eta": ["\uf252", "⇥"],
  cache: ["\uf1c0", "≈"], cost: ["\ueec1", "$"], worktree: ["\uf1bb", "⑂"],
};
const BARS = {
  eighths: [" ▏▎▍▌▋▊▉█", " "], blocks: [" █", "░"], shapes: [" ▰", "▱"],
  dots: [" ●", "○"], braille: [" ⣿", "⣀"], ascii: [" =", "-"],
};
export const DEFAULT_PRIORITY = {
  model: 5, context: 5,
  dir: 4, git: 4, quota: 4, "quota.5h": 4, cost: 4,
  "quota.7d": 3, "quota.eta": 3, worktree: 3, state: 3,
  cache: 2, cycle: 2, sandbox: 2,
  vcs: 1,
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
    quotaPace: preferences.quotaPace ?? "auto",
    dirStyle: preferences.dirStyle ?? "auto",
    customItems: preferences.items ?? {},
  };
  const values = new Map(segments.map(segment => [segment.id, segment]));
  const indices = new Map(segments.map((segment, index) => [segment.id, index]));
  const columns = Number.isFinite(width) && width > 0 ? Math.min(1000, Math.floor(width)) : 0;
  const rows = presetRows(preferences);
  const make = item => {
    const value = values.get(item.metric);
    return value && formatItemVariants(item, value, indices.get(item.metric), options);
  };
  return rows.map(row => {
    const left = row.left.map(make).filter(Boolean);
    const right = row.right.map(make).filter(Boolean);
    return fitRow(left, right, columns, options);
  }).filter(Boolean).join("\n");
}

function formatItemVariants(item, segment, index, theme) {
  const priority = typeof item.priority === "number" ? item.priority : (DEFAULT_PRIORITY[segment.id] ?? 3);
  return {
    metric: segment.id,
    priority,
    variants: [
      formatItemAt(item, segment, index, theme, 0),
      formatItemAt(item, segment, index, theme, 1),
      formatItemAt(item, segment, index, theme, 2),
    ],
  };
}

function formatItemAt(item, segment, index, theme, level) {
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
  let icon = level < 2 ? iconFor(item, segment.id, theme) : "";
  let graph = "";
  let text = sanitizeText(segment.text);
  const widget = item.widget ?? (segment.id === "context" ? (theme.native ? "bar" : "legacy-bar")
    : segment.id.startsWith("quota.") ? "pace" : "text");
  text = formatSegmentText(text, item, segment, widget, theme, level);
  if (theme.icons === "ascii") text = text.replaceAll(" · ", " / ");
  if (typeof segment.gauge === "number") {
    const cells = item.cells ?? (theme.native ? 8 : 5);
    const barStyle = theme.icons === "ascii" ? "ascii" : item.bar ?? (theme.native ? "shapes" : "blocks");
    if (widget === "gauge" && level < 2 && theme.icons !== "ascii") {
      icon = gaugeIcon(segment.gauge, theme.icons);
    } else if (widget === "bar" && level === 0) {
      graph = renderBar(segment.gauge, cells, barStyle, item.coloring, theme, filled ? background : undefined, filled ? fillText : foreground);
    } else if (widget === "legacy-bar" && level === 0) {
      const filledCells = Math.round(segment.gauge * cells / 100);
      const [mark, empty] = theme.icons === "ascii" ? ["#", "-"] : ["█", "░"];
      text += ` ${mark.repeat(filledCells)}${empty.repeat(cells - filledCells)}`;
    } else if (widget === "pace" && level === 0 && segment.pace != null) {
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

function segmentFields(segment, item, theme) {
  const base = segment.fields ? { ...segment.fields } : {};
  const glyphs = ICON_SETS[theme.icons];
  if (segment.id === "dir" && theme.dirStyle === "auto" && item.style && Object.hasOwn(base, item.style)) {
    base.path = base[item.style];
  }
  if (segment.git) {
    base.dirty = segment.dirty ? glyphs.dirty : null;
    base.status = segment.conflicts > 0 ? glyphs.warn : segment.dirty ? glyphs.dirty : (theme.icons === "ascii" ? "ok" : "✓");
    base.ahead = segment.ahead > 0 ? `${glyphs.ahead}${segment.ahead}` : null;
    base.behind = segment.behind > 0 ? `${glyphs.behind}${segment.behind}` : null;
  }
  if (segment.id === "quota.5h" || segment.id === "quota.7d") {
    if (segment.paceDelta != null) {
      base.arrow = paceArrow(segment.paceDelta, theme.icons);
    }
    if (theme.quotaPace === "hide") {
      base.pace = null;
      base.arrow = null;
    }
  }
  return base;
}

function formatSegmentText(base, item, segment, widget, theme, level = 0) {
  const fields = segmentFields(segment, item, theme);
  const pickLevel = (full, compact, minimal) => {
    const template = level === 0 ? full : level === 1 ? (item.compact ?? compact) : (item.minimal ?? minimal);
    return renderTemplate(template, fields) || base;
  };
  if (segment.id === "model") {
    return pickLevel(item.format ?? "{name}[ {effort}]", "{name}", "{family}");
  }
  if (segment.id === "dir") {
    const fullTemplate = item.format ?? "{path}";
    if (level === 0) return renderTemplate(fullTemplate, fields) || base;
    const compactDefault = theme.dirStyle === "full" || theme.dirStyle === "tilde"
      ? "{parent}"
      : theme.dirStyle === "auto" ? "{name}" : fullTemplate;
    return pickLevel(fullTemplate, compactDefault, "{name}");
  }
  if (segment.git) {
    const fullDefault = segment.detached
      ? "{branch}[ {dirty}][ {ahead}][ {behind}]"
      : "{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}]";
    return pickLevel(item.format ?? fullDefault, "{branch}[ {dirty}]", "{branch}");
  }
  if (segment.id === "context") {
    const fullTemplate = contextTemplate(item, theme);
    const keepInCompact = theme.contextFormat === "ratio" || theme.contextFormat === "tokens";
    const compactTemplate = keepInCompact ? fullTemplate : "{pct}%";
    return pickLevel(fullTemplate, compactTemplate, "{pct}%");
  }
  if (segment.id === "quota.5h" || segment.id === "quota.7d") {
    const prefix = segment.id.slice(6);
    const customFormat = Boolean(theme.customItems?.[segment.id]?.format);
    const showPace = segment.paceDelta != null
      && (theme.quotaPace === "show" || (theme.quotaPace === "auto" && widget === "pace"));
    if (level === 0) {
      const template = item.format ?? (showPace ? `${prefix} {pct}%[ {arrow}][ · {left}]` : `${prefix} {pct}%[ · {left}]`);
      let rendered = renderTemplate(template, fields) || base;
      const shouldAppendArrow = item.format && fields.arrow && !templateUsesField(item.format, ["pace", "arrow"])
        && (customFormat ? theme.quotaPace === "show" : showPace);
      if (shouldAppendArrow) {
        rendered += ` ${fields.arrow}`;
      }
      return rendered;
    }
    const compactDefault = showPace ? `${prefix} {pct}%[ {arrow}]` : `${prefix} {pct}%`;
    return pickLevel(compactDefault, compactDefault, `${prefix} {pct}%`);
  }
  if (segment.id === "quota") {
    return pickLevel(item.format ?? "{text}[ · {left}]", "{text}", "{pct}%");
  }
  if (segment.id === "quota.eta") {
    return pickLevel(item.format ?? "ETA {left}", "ETA {left}", "{left}");
  }
  if (segment.id === "cache") {
    const fullDefault = fields.read != null
      ? "cache {read} read[ · {created} created]"
      : "cache {created} created";
    const compactDefault = fields.read != null ? "{read} read" : "{created} created";
    const minimalDefault = fields.read != null ? "{read}" : "{created}";
    return pickLevel(item.format ?? fullDefault, compactDefault, minimalDefault);
  }
  if (segment.fields) {
    const template = level === 0 ? item.format : level === 1 ? (item.compact ?? item.format) : (item.minimal ?? item.compact ?? item.format);
    if (template) {
      const rendered = renderTemplate(template, fields);
      if (rendered) return rendered;
    }
  }
  return base;
}

function contextTemplate(item, theme) {
  if (theme.customItems?.context?.format && item.format) return item.format;
  const prefix = item.format?.startsWith("ctx ") ? "ctx " : "";
  const format = theme.contextFormat ?? "auto";
  if (format === "percent") return `${prefix}{pct}%`;
  if (format === "tokens") return `${prefix}{pct}%[ · {tokens}]`;
  if (format === "ratio") return `${prefix}{pct}%[ · {tokens}[/{window}]]`;
  if (item.format) return item.format;
  return theme.native ? "{pct}%[ · {tokens}]" : "{pct}%";
}

export function resolveIcon(item, id, { icons, native }) {
  if (item.icon != null) return item.icon;
  if (native) {
    if (icons === "none" || icons === "ascii") return "";
    const entry = UPSTREAM_ICONS[id] ?? (id.startsWith("quota.") ? UPSTREAM_ICONS.quota : undefined);
    if (entry) return entry[icons === "nerd" ? 0 : 1];
  }
  return ICON_SETS[icons]?.[id] ?? "";
}

function iconFor(item, id, theme) {
  return resolveIcon(item, id, theme);
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

function fitRow(left, right, width, options) {
  const slots = [
    ...left.map((item, index) => ({ item, side: "left", index, level: 0, dropped: false })),
    ...right.map((item, index) => ({ item, side: "right", index, level: 0, dropped: false })),
  ];
  if (!slots.length) return "";
  const assemble = (budget) => {
    const leftViews = slots.filter(slot => !slot.dropped && slot.side === "left").map(slot => slot.item.variants[slot.level]);
    const rightViews = slots.filter(slot => !slot.dropped && slot.side === "right").map(slot => slot.item.variants[slot.level]);
    return joinSides(leftViews, rightViews, budget, options);
  };
  if (!width) return assemble(0);

  let rendered = assemble(width);
  if (visibleWidth(rendered) <= width) return rendered;

  const variantWidth = (slot, level) => visibleWidth(compose([slot.item.variants[level]], options, slot.side));
  const compareVictim = (a, b) => (
    a.item.priority - b.item.priority
    || (a.side === "left" ? 1 : 0) - (b.side === "left" ? 1 : 0)
    || b.index - a.index
  );

  for (const targetLevel of [1, 2]) {
    while (visibleWidth(rendered) > width) {
      const candidates = slots
        .filter(slot => !slot.dropped && slot.level < targetLevel && variantWidth(slot, targetLevel) < variantWidth(slot, slot.level))
        .sort(compareVictim);
      if (!candidates.length) break;
      candidates[0].level = targetLevel;
      rendered = assemble(width);
    }
    if (visibleWidth(rendered) <= width) return rendered;
  }

  while (visibleWidth(rendered) > width) {
    const active = slots.filter(slot => !slot.dropped);
    if (active.length <= 1) break;
    active.sort(compareVictim);
    active[0].dropped = true;
    rendered = assemble(width);
  }
  if (visibleWidth(rendered) <= width) return rendered;

  const last = slots.find(slot => !slot.dropped);
  return last ? renderBounded([last.item.variants[last.level]], width, options, last.side) : "";
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
