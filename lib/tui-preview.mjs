import { colorDepth, visibleWidth } from "./ansi.mjs";
import { renderLine } from "./render.mjs";
import { PREVIEW_SCENARIOS, scenarioPayload } from "./sample.mjs";
import { collectSegments } from "./segments.mjs";
import { MUTED, RESET, styleBold, choiceChip } from "./tui-ui.mjs";

export const MAX_PREVIEW_LINES = 6;
export const MIN_PREVIEW_WIDTH = 20;
export const WIDTH_STEP = 4;

const DEPTH_OVERRIDES = [null, "truecolor", "256", "16", "none"];
const GLYPH_OVERRIDES = [null, "nerd", "unicode", "ascii", "none"];

export class PreviewController {
  constructor() {
    this.scenarioIndex = 0;
    this.width = null;
    this.fit = 96;
    this.depthIndex = 0;
    this.glyphIndex = 0;
  }

  scenario() {
    return PREVIEW_SCENARIOS[this.scenarioIndex] ?? PREVIEW_SCENARIOS[0];
  }

  scenarioName() {
    return this.scenario().name;
  }

  nextScenario(delta = 1) {
    const n = PREVIEW_SCENARIOS.length;
    this.scenarioIndex = (this.scenarioIndex + delta + n) % n;
  }

  selectScenario(name) {
    const idx = PREVIEW_SCENARIOS.findIndex((s) => s.name === name);
    if (idx >= 0) this.scenarioIndex = idx;
  }

  resize(delta) {
    const fit = Math.max(MIN_PREVIEW_WIDTH, this.fit);
    const current = this.width ?? fit;
    const next = Math.max(MIN_PREVIEW_WIDTH, Math.min(fit, current + delta));
    this.width = next >= fit ? null : next;
  }

  cycleDepth() {
    this.depthIndex = (this.depthIndex + 1) % DEPTH_OVERRIDES.length;
  }

  cycleGlyphs() {
    this.glyphIndex = (this.glyphIndex + 1) % GLYPH_OVERRIDES.length;
  }

  columns() {
    const fit = Math.max(1, this.fit);
    if (this.width == null) return fit;
    return Math.max(1, Math.min(this.width, fit));
  }

  effectivePreferences(prefs) {
    const depthOverride = DEPTH_OVERRIDES[this.depthIndex];
    const glyphOverride = GLYPH_OVERRIDES[this.glyphIndex];
    if (!depthOverride && !glyphOverride) return prefs;
    return {
      ...prefs,
      ...(depthOverride ? { colorDepth: depthOverride } : {}),
      ...(glyphOverride ? { icons: glyphOverride } : {}),
    };
  }

  resolvedDepth(prefs, env = process.env) {
    const override = DEPTH_OVERRIDES[this.depthIndex];
    if (override) return override;
    return colorDepth(prefs.colorDepth, { env, enabled: true });
  }

  render(prefs, width = this.columns(), { maxLines = MAX_PREVIEW_LINES, env = process.env, emptyText = "" } = {}) {
    const effective = this.effectivePreferences(prefs);
    const { payload, git } = scenarioPayload(this.scenario(), width);
    const segments = collectSegments(payload, effective, git, {
      home: "/Users/ada",
      now: Date.now(),
    });
    const renderEnv = DEPTH_OVERRIDES[this.depthIndex] ? {} : env;
    const raw = renderLine(segments, effective, { width, color: true, env: renderEnv });
    const lines = raw.split(/\r?\n/).filter((line) => visibleWidth(line.trim()) > 0);
    if (lines.length === 0) {
      return emptyText ? [`${MUTED}${emptyText}${RESET}`] : [""];
    }
    return lines.slice(0, maxLines);
  }

  title(prefs, { showing = null, room = 80, language = "en", env = process.env } = {}) {
    const zh = language === "zh";
    const depthOverride = DEPTH_OVERRIDES[this.depthIndex];
    const resolvedDepth = this.resolvedDepth(prefs, env);
    const depthLabel = depthOverride
      ? shortDepth(depthOverride)
      : `${zh ? "自动" : "auto"}·${shortDepth(resolvedDepth)}`;
    const glyphValue = GLYPH_OVERRIDES[this.glyphIndex] ?? prefs.icons;
    const widthValue = this.width != null
      ? String(this.columns())
      : `${zh ? "适应" : "fit"} ${this.fit}`;
    const scenarioValue = this.scenarioName();

    const heading = showing
      ? ` ${zh ? "预览" : "Preview"} · ${showing} `
      : ` ${zh ? "预览" : "Preview"} `;

    const values = [
      [zh ? "场景" : "scenario", scenarioValue],
      [zh ? "宽度" : "width", widthValue],
      [zh ? "色深" : "depth", depthLabel],
      [zh ? "图标" : "glyphs", glyphValue],
    ];

    const build = (withLabels) => {
      const parts = [styleBold(heading)];
      for (const [label, value] of values) {
        parts.push(withLabels ? ` ${label} ` : " ");
        parts.push(choiceChip(value));
      }
      parts.push(`  ${MUTED}[ ] - + { }${RESET} `);
      return parts.join("");
    };

    const full = build(true);
    if (visibleWidth(full) <= room) return full;
    return build(false);
  }

  ruler(width = this.columns()) {
    const w = Math.max(1, width);
    let out = "";
    for (let col = 1; col <= w; col += 1) {
      out += col % 10 === 0 ? String(Math.floor(col / 10) % 10) : "·";
    }
    return `${MUTED}${out}${RESET}`;
  }
}

function shortDepth(depth) {
  if (depth === "truecolor") return "true";
  return depth;
}
