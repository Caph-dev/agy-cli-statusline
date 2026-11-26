import { colorDepth, colorRgb, paint, sanitizeText, truncateVisible, visibleWidth } from "./ansi.mjs";
import { ICON_SETS, PRESETS, THEMES, defaultWidgetFor, presetRows } from "./preferences.mjs";
import { compactCount, formatSubagentDuration, paceArrow } from "./segments.mjs";
import { SUBAGENT_MAX_ROWS, formatUsdToday } from "./telemetry.mjs";
import { renderTemplate, renderTemplateParts, templateUsesField } from "./template.mjs";

const CHEVRON = "\ue0b0";
const CHEVRON_LEFT = "\ue0b2";
const SEPARATORS = { plain: " · ", compact: " | ", bracket: " ", pill: " " };
const CATEGORY = {
  model: "identity", dir: "workspace", git: "vcs", vcs: "vcs", worktree: "vcs",
  context: "context", quota: "quota", "quota.5h": "quota", "quota.7d": "quota", "quota.eta": "quota",
  cache: "cache", cost: "cost", "cost.today": "cost", tps: "timing",
  state: "activity", subagents: "activity", cycle: "session", sandbox: "system",
};
export const UPSTREAM_ICONS = {
  model: ["\uef23", "◆"], dir: ["\u{f024b}", "▣"], git: ["\u{f02a2}", "⎇"],
  context: ["\uf49b", "◔"], quota: ["\u{f0520}", "◷"], "quota.eta": ["\uf252", "⇥"],
  cache: ["\uf1c0", "≈"], cost: ["\ueec1", "$"], "cost.today": ["\u{f00ed}", "▦"],
  tps: ["\u{f04c5}", "»"], worktree: ["\uf1bb", "⑂"], subagents: ["\u{f04aa}", "⑂"],
};
const BARS = {
  eighths: [" ▏▎▍▌▋▊▉█", " "], blocks: [" █", "░"], shapes: [" ▰", "▱"],
  dots: [" ●", "○"], braille: [" ⣿", "⣀"], ascii: [" =", "-"],
};

export function renderLine(segments, preferences, { width = 0, color = true, env = process.env } = {}) {
  const options = {
    preset: preferences.preset,
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
  const subagentTrees = [];
  const make = item => {
    const value = values.get(item.metric);
    if (!value) return null;
    if (item.metric === "subagents" && defaultWidgetFor("subagents", item, options) === "tree") {
      subagentTrees.push({ item, value });
      return null;
    }
    return formatItem(item, value, indices.get(item.metric), options);
  };
  const mainLines = rows.flatMap(row => {
    const left = row.left.map(make).filter(Boolean);
    const right = row.right.map(make).filter(Boolean);
    return fitRows(left, right, columns, options);
  }).filter(Boolean);
  const treeLines = subagentTrees.flatMap(({ item, value }) => renderSubagentTree(item, value, columns, options));
  return [...mainLines, ...treeLines].filter(Boolean).join("\n");
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
  const baseText = sanitizeText(segment.text);
  const widget = defaultWidgetFor(segment.id, item, theme);
  let parts = formatSegmentParts(baseText, item, segment, widget, theme);
  if (theme.icons === "ascii") {
    parts = parts.map((part) => ({
      ...part,
      text: part.text.replaceAll(" · ", " / ").replaceAll("×", "x"),
    }));
  }
  let isDynamicGauge = false;
  if (typeof segment.gauge === "number") {
    const cells = item.cells ?? (theme.native ? 8 : 5);
    const barStyle = theme.icons === "ascii" ? "ascii" : item.bar ?? (theme.native ? "shapes" : "blocks");
    if (widget === "gauge" && theme.icons !== "ascii") {
      icon = gaugeIcon(segment.gauge, theme.icons);
      isDynamicGauge = true;
    } else if (widget === "bar") {
      graph = renderBar(segment.gauge, cells, barStyle, item.coloring, theme, filled ? background : undefined, filled ? fillText : foreground);
    } else if (widget === "legacy-bar") {
      const filledCells = Math.round(segment.gauge * cells / 100);
      const [mark, empty] = theme.icons === "ascii" ? ["#", "-"] : ["█", "░"];
      parts = [...parts, { text: ` ${mark.repeat(filledCells)}${empty.repeat(cells - filledCells)}`, role: "text" }];
    } else if (widget === "pace" && segment.pace != null) {
      if (theme.icons !== "ascii" && theme.depth !== "none") {
        graph = renderPace(segment.gauge, segment.pace, cells, colors, foreground, theme.depth);
      }
    }
  }
  const text = parts.map((part) => part.text).join("");
  const okColor = colors?.ok ?? palette.gauge?.[0] ?? "green";
  const critColor = colors?.crit ?? palette.gauge?.[2] ?? "red";
  const mutedColor = colors?.muted ?? palette.muted ?? "brightBlack";
  const roleColors = filled ? {
    text: fillText,
    good: contrastRatio(okColor, background) >= 3.0 ? okColor : fillText,
    bad: contrastRatio(critColor, background) >= 3.0 ? critColor : fillText,
    muted: mix(background, fillText, 0.5) ?? fillText,
  } : {
    text: foreground,
    good: okColor,
    bad: critColor,
    muted: mutedColor,
  };
  return {
    icon, graph, text, parts, roleColors,
    iconColor: item.icon_color ?? (filled ? fillText : (isDynamicGauge ? foreground : categoryColor)),
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

function formatSegmentParts(base, item, segment, widget, theme) {
  const fields = segmentFields(segment, item, theme);
  const roles = segment.fieldRoles ?? null;
  const fallback = base ? [{ text: base, role: "text" }] : [];
  const render = (template) => {
    const parts = renderTemplateParts(template, fields, roles);
    return parts.length ? parts : fallback;
  };
  if (segment.id === "model") {
    return render(item.format ?? "{name}[ {effort}]");
  }
  if (segment.id === "dir") {
    return render(item.format ?? "{path}");
  }
  if (segment.git) {
    const fullDefault = segment.detached
      ? "{branch}[ {dirty}][ {ahead}][ {behind}]"
      : "{branch}[ {dirty}][ {ahead}][ {behind}][ {sha}]";
    return render(item.format ?? fullDefault);
  }
  if (segment.id === "context") {
    return render(contextTemplate(item, theme));
  }
  if (segment.id === "quota.5h" || segment.id === "quota.7d") {
    const prefix = segment.id.slice(6);
    const customFormat = Boolean(theme.customItems?.[segment.id]?.format);
    const showPace = segment.paceDelta != null
      && (theme.quotaPace === "show" || (theme.quotaPace === "auto" && widget === "pace"));
    const template = item.format ?? (showPace ? `${prefix} {pct}%[ {arrow}][ · {left}]` : `${prefix} {pct}%[ · {left}]`);
    const rendered = render(template);
    const shouldAppendArrow = item.format && fields.arrow && !templateUsesField(item.format, ["pace", "arrow"])
      && (customFormat ? theme.quotaPace === "show" : showPace);
    if (shouldAppendArrow) {
      return [...rendered, { text: " ", role: "text" }, { text: fields.arrow, role: roles?.arrow ?? "text" }];
    }
    return rendered;
  }
  if (segment.id === "quota") {
    return render(item.format ?? "{text}[ · {left}]");
  }
  if (segment.id === "quota.eta") {
    return render(item.format ?? "ETA {left}");
  }
  if (segment.id === "cache") {
    const rendered = trimOuterSeparators(renderTemplate(item.format ?? "[{left}][{cold}][ · {hit}% hit]", fields));
    return rendered ? [{ text: rendered, role: "text" }] : fallback;
  }
  if (segment.id === "cost.today") {
    return render(item.format ?? "{usd} today");
  }
  if (segment.id === "tps") {
    return render(item.format ?? "{tps} tok/s");
  }
  if (segment.id === "subagents") {
    const rendered = trimOuterSeparators(renderTemplate(
      item.format ?? "[{running} running][ · {waiting} waiting][ · {done} done]",
      fields,
    ));
    return rendered ? [{ text: rendered, role: "text" }] : fallback;
  }
  if (segment.fields && item.format) {
    const rendered = renderTemplateParts(item.format, fields, roles);
    if (rendered.length) return rendered;
  }
  return fallback;
}

function trimOuterSeparators(text) {
  return String(text ?? "")
    .replace(/^(?:\s*[·/|│]\s*)+/, "")
    .replace(/(?:\s*[·/|│]\s*)+$/, "")
    .trim();
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

export function gaugeIcon(pct, icons) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  if (icons === "nerd") {
    if (value <= 0) return "\u{f0766}";
    const step = Math.min(8, Math.max(1, Math.round((value / 100) * 8)));
    return String.fromCodePoint(0xf0a9e + step - 1);
  }
  if (value <= 0) return "○";
  const step = Math.min(4, Math.max(1, Math.round((value / 100) * 4)));
  return "○◔◑◕●"[step];
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

function relativeLuminance(rgb) {
  return rgb.reduce((sum, value, i) => {
    const x = value / 255;
    return sum + [0.2126, 0.7152, 0.0722][i] * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  }, 0);
}

function contrastRatio(first, second) {
  const a = colorRgb(first);
  const b = colorRgb(second);
  if (!a || !b) return 0;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readableInk(background, preferred) {
  if (!background) return preferred;
  const rgb = colorRgb(background);
  if (!rgb) return preferred;
  return relativeLuminance(rgb) >= 0.18 ? "#111111" : "#f5f5f5";
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
  return [...leftRows, ...rightRows.map(line => " ".repeat(Math.max(0, width - visibleWidth(line))) + line)];
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
  if (first.icon) {
    const withIconFrame = visibleWidth(compose([{ ...first, graph: "", text: "x", parts: undefined }], options, side)) - 1;
    if (width > withIconFrame) {
      const clipped = truncateVisible(first.text, width - withIconFrame);
      if (clipped) return compose([{ ...first, graph: "", text: clipped, parts: undefined }], options, side);
    }
  }
  const textOnly = { ...first, icon: "", graph: "", text: "", parts: undefined };
  const frameWidth = visibleWidth(compose([textOnly], options, side));
  if (width <= frameWidth) return truncateVisible(first.text, width);
  return compose([{ ...textOnly, text: truncateVisible(first.text, width - frameWidth) }], options, side);
}

function compose(items, { skin, depth, palette, separator, icons, native }, side = "left") {
  if (!items.length) return "";
  const style = (foreground, background, text) => paint(foreground, background, text, depth);
  const sepColor = palette.colors?.separator;
  const body = item => {
    const { foreground, background, icon, text, parts, iconColor, graph, roleColors } = item;
    const renderedText = parts?.length
      ? parts.map((part) => style(roleColors?.[part.role] ?? foreground, background, part.text)).join("")
      : style(foreground, background, text);
    return [style(iconColor, background, icon), graph, renderedText]
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

function renderSubagentTree(item, segment, width, theme) {
  const list = Array.isArray(segment.subagents) ? segment.subagents : [];
  if (list.length === 0) return [];

  const shown = list.slice(0, SUBAGENT_MAX_ROWS);
  const more = list.length - shown.length;
  const ascii = theme.icons === "ascii";
  const palette = theme.palette;
  const colors = palette.colors;
  const slot = (index) => palette.slots?.[index % palette.slots.length];
  const okColor = colors?.ok ?? palette.gauge?.[0] ?? "green";
  const warnColor = colors?.warn ?? palette.gauge?.[1] ?? "yellow";
  const critColor = colors?.crit ?? palette.gauge?.[2] ?? "red";
  const mutedColor = colors?.muted ?? palette.muted ?? "brightBlack";
  const sepColor = colors?.separator ?? mutedColor;
  const agentColor = colors?.warn ?? colors?.activity ?? slot(4) ?? "yellow";
  const modelColor = colors?.identity ?? slot(0);
  const ctxColor = colors?.context ?? slot(3);
  const cacheColor = colors?.cache ?? slot(2);
  const costColor = colors?.cost ?? slot(4);
  const dot = ascii ? " / " : " · ";
  const filled = theme.skin === "powerline" || theme.skin === "pill";
  const subIcon = (id) => (ascii ? "" : resolveIcon({}, id, theme));
  const nameIcon = item.icon != null ? item.icon : (ascii ? "" : iconFor(item, "subagents", theme));

  const makeCell = (category, color, icon, rawText) => {
    const text = ascii ? sanitizeText(rawText).replaceAll(" · ", " / ").replaceAll("…", "...") : sanitizeText(rawText);
    const explicitFill = palette.segments?.[category];
    const background = explicitFill?.[0] ?? color;
    const fillText = explicitFill?.[1] ?? readableInk(background, colors?.onfill ?? palette.text);
    return {
      icon,
      graph: "",
      text,
      parts: [{ text, role: "text" }],
      roleColors: { text: filled ? fillText : color },
      iconColor: filled ? fillText : color,
      foreground: filled ? fillText : color,
      background: filled ? background : undefined,
    };
  };

  const matrix = shown.map((sub) => {
    const nameText = sub.role ? `${sub.typeName}${dot}${sub.role}` : sub.typeName;
    const col0 = makeCell("activity", agentColor, nameIcon, nameText);

    const col1 = sub.model
      ? makeCell("identity", modelColor, subIcon("model"), sub.model)
      : null;

    let col2 = null;
    if (sub.contextPct != null) {
      const cColor = sub.contextPct >= 90 ? critColor : sub.contextPct >= 70 ? warnColor : ctxColor;
      const cIcon = ascii ? "" : gaugeIcon(sub.contextPct, theme.icons);
      const cText = sub.contextTokens != null
        ? `${sub.contextPct}%${dot}${compactCount(sub.contextTokens)}`
        : `${sub.contextPct}%`;
      col2 = makeCell("context", cColor, cIcon, cText);
    } else if (sub.contextTokens != null && sub.contextTokens > 0) {
      col2 = makeCell("context", ctxColor, subIcon("context"), compactCount(sub.contextTokens));
    }

    const col3 = sub.cacheHit != null
      ? makeCell("cache", cacheColor, subIcon("cache"), `${sub.cacheHit}% hit`)
      : null;

    const rawCostIcon = subIcon("cost");
    const costIcon = rawCostIcon === "$" ? "" : rawCostIcon;
    const col4 = sub.costUsd != null && sub.costUsd > 0
      ? makeCell("cost", costColor, costIcon, formatUsdToday(sub.costUsd))
      : null;

    let statusIcon;
    let statusText;
    let statusColor;
    if (sub.status === "waiting") {
      statusIcon = ascii ? "*" : "●";
      statusText = "waiting";
      statusColor = warnColor;
    } else if (sub.status === "running") {
      statusIcon = ascii ? "*" : "●";
      statusText = sub.durationMs != null ? formatSubagentDuration(sub.durationMs) : "running";
      statusColor = okColor;
    } else if (sub.status === "error") {
      statusIcon = ascii ? "!" : "✗";
      statusText = "error";
      statusColor = critColor;
    } else if (sub.status === "killed") {
      statusIcon = ascii ? "x" : "×";
      statusText = "stopped";
      statusColor = mutedColor;
    } else {
      statusIcon = ascii ? "ok" : "✓";
      const dur = sub.durationMs != null ? formatSubagentDuration(sub.durationMs) : null;
      const stepPart = sub.steps > 0 ? `${sub.steps} ${sub.steps === 1 ? "step" : "steps"}` : null;
      statusText = [dur ? `done ${dur}` : "done", stepPart].filter(Boolean).join(dot);
      statusColor = mutedColor;
    }
    const col5 = makeCell("activity", statusColor, statusIcon, statusText);

    return [col0, col1, col2, col3, col4, col5];
  });

  const activeCols = [0, 1, 2, 3, 4, 5].filter((col) => matrix.some((row) => row[col] != null));
  const branchMid = ascii ? "|-" : "├";
  const branchLast = ascii ? "\\-" : "└";
  const joiner = theme.skin === "bracket" || theme.skin === "pill"
    ? " "
    : (theme.separator ?? (ascii ? " | " : theme.native ? " │ " : SEPARATORS[theme.skin]));
  const styledJoiner = theme.skin === "bracket" || theme.skin === "pill"
    ? " "
    : paint(sepColor, undefined, joiner, theme.depth);
  const blankJoiner = " ".repeat(visibleWidth(joiner));
  const renderSingle = (cell) => compose([cell], theme, "left");

  // Compute max column widths across shown rows (last status column 5 is never padded, matching agy-zh-pack)
  const colWidths = new Map();
  if (shown.length >= 2) {
    for (const col of activeCols) {
      if (col === 5) continue;
      let maxW = 0;
      for (const row of matrix) {
        const cell = row[col];
        if (!cell) continue;
        const w = theme.skin === "powerline"
          ? visibleWidth([cell.icon, cell.text].filter(Boolean).join(" "))
          : visibleWidth(renderSingle(cell));
        if (w > maxW) maxW = w;
      }
      colWidths.set(col, maxW);
    }
  }

  const formatRowAligned = (row, prefixStyled) => {
    if (theme.skin === "powerline") {
      const cells = [];
      for (const col of activeCols) {
        const cell = row[col];
        if (!cell) continue;
        const target = colWidths.get(col) || 0;
        const cur = visibleWidth([cell.icon, cell.text].filter(Boolean).join(" "));
        const pad = target > cur ? " ".repeat(target - cur) : "";
        const paddedText = cell.text + pad;
        cells.push(pad ? { ...cell, text: paddedText, parts: [{ text: paddedText, role: "text" }] } : cell);
      }
      return prefixStyled + compose(cells, theme, "left");
    }
    let body = "";
    activeCols.forEach((col, index) => {
      const cell = row[col];
      const target = colWidths.get(col) || 0;
      if (index > 0) body += cell ? styledJoiner : blankJoiner;
      if (cell) {
        const rendered = renderSingle(cell);
        const gap = target - visibleWidth(rendered);
        body += gap > 0 ? rendered + " ".repeat(gap) : rendered;
      } else if (target > 0) {
        body += " ".repeat(target);
      }
    });
    return prefixStyled + body;
  };

  const lines = [];
  matrix.forEach((row, rowIndex) => {
    const isLast = rowIndex === matrix.length - 1 && more === 0;
    const rawPrefix = width > 0 && width <= 8
      ? `${isLast ? branchLast : branchMid} `
      : ` ${isLast ? branchLast : branchMid} `;
    const prefixText = width > 0 && visibleWidth(rawPrefix) >= width
      ? truncateVisible(rawPrefix.trimStart(), width)
      : rawPrefix;
    const prefixWidth = visibleWidth(prefixText);
    const prefixStyled = paint(mutedColor, undefined, prefixText, theme.depth);

    const aligned = formatRowAligned(row, prefixStyled);
    if (!width || visibleWidth(aligned) <= width) {
      lines.push(aligned);
      return;
    }

    const present = activeCols.map((col) => row[col]).filter(Boolean);
    const compact = prefixStyled + compose(present, theme, "left");
    if (visibleWidth(compact) <= width) {
      lines.push(compact);
      return;
    }

    if (width <= prefixWidth) {
      const plain = present.map((c) => [c.icon, c.text].filter(Boolean).join(" ")).join(" ");
      lines.push(truncateVisible(plain, width));
      return;
    }

    const avail = width - prefixWidth;
    const contPrefix = " ".repeat(prefixWidth);
    const groups = [];
    let group = [];
    for (const cell of present) {
      if (group.length && visibleWidth(compose([...group, cell], theme, "left")) > avail) {
        groups.push(renderBounded(group, avail, theme, "left"));
        group = [];
      }
      group.push(cell);
    }
    if (group.length) groups.push(renderBounded(group, avail, theme, "left"));
    groups.forEach((chunk, chunkIndex) => {
      lines.push((chunkIndex === 0 ? prefixStyled : contPrefix) + chunk);
    });
  });

  if (more > 0) {
    const rawMore = ` ${branchLast} +${more} more ${more === 1 ? "subagent" : "subagents"}`;
    const clipped = width > 0 && visibleWidth(rawMore) > width
      ? truncateVisible(rawMore.trimStart(), width)
      : rawMore;
    lines.push(paint(mutedColor, undefined, clipped, theme.depth));
  }

  return lines;
}

export function renderPlain(segments, preferences, options = {}) {
  return renderLine(segments, preferences, { ...options, color: false });
}
