import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sanitizeText } from "./ansi.mjs";
import {
  ITEM_FORMAT_PRESETS,
  ITEM_WIDGETS,
  PRESETS,
  defaultWidgetFor,
  normalizePreferences,
  presetBaseItem,
  presetHasStructuredLayout,
  presetRows,
} from "./preferences.mjs";
import { resolveIcon } from "./render.mjs";

export const PRESET_FILTERS = [
  "all",
  "mine",
  "minimal",
  "multi-line",
  "powerline",
  "quota",
  "cache",
  "context",
];

export const PRESET_NAME_MAX = 32;

export const BUILTIN_PRESET_META = [
  {
    name: "cometix",
    tags: [],
    summary: {
      en: "Classic look: model, directory, git, context and cache on one line",
      zh: "经典单行风格：模型、目录、Git、上下文圆环与缓存",
    },
  },
  {
    name: "minimal",
    tags: ["minimal"],
    summary: {
      en: "Model, context, cache and cost, no icons",
      zh: "极简无图标：模型、上下文、缓存与花费",
    },
  },
  {
    name: "dashboard",
    tags: ["multi-line", "quota", "context"],
    summary: {
      en: "Three lines: identity, meters, code activity",
      zh: "三行仪表盘：基础信息、用量条与工作区指标",
    },
  },
  {
    name: "budget",
    tags: ["multi-line", "quota"],
    summary: {
      en: "Rate limits with pace and run-out, daily spend, context and cache",
      zh: "配额速率与耗尽估算、今日花费、上下文与缓存",
    },
  },
  {
    name: "cache-aware",
    tags: ["multi-line", "cache"],
    summary: {
      en: "Prompt cache countdown, hit ratio and misses under the usual line",
      zh: "双行缓存监控：常规行搭配缓存倒计时、命中率与未命中详情",
    },
  },
  {
    name: "focus",
    tags: ["multi-line", "context"],
    summary: {
      en: "A wide gradient context bar with cache on a clean two-row split",
      zh: "上下文焦点：宽渐变进度条与缓存的双行分栏布局",
    },
  },
  {
    name: "zen",
    tags: ["minimal"],
    summary: {
      en: "Plain ASCII without color, for any terminal",
      zh: "无色纯 ASCII 风格，兼容任意终端",
    },
  },
  {
    name: "powerline",
    tags: ["powerline", "quota"],
    summary: {
      en: "Powerline segments with a quota gauge, in Tokyo Night colors",
      zh: "Powerline 箭头分段配额样式（Tokyo Night 配色）",
    },
  },
  {
    name: "author",
    tags: ["multi-line", "quota", "cache", "context"],
    summary: {
      en: "Author's pick: 3-row Catppuccin Mocha with Orchestrator phase, cache hit, TPS, Git diff, quota pace & subagents",
      zh: "作者同款：三行 Catppuccin Mocha，含 Orchestrator 阶段、缓存命中、TPS、Git 变更、配额速率与子代理树",
    },
  },
  {
    name: "studio",
    tags: ["powerline", "quota"],
    summary: {
      en: "Default Dusk powerline layout with subagent tree and session state",
      zh: "默认 Dusk Powerline 布局，含配额、状态与子代理树",
    },
  },
  {
    name: "signal",
    tags: ["powerline", "quota"],
    summary: {
      en: "High-contrast Signal powerline with Nerd glyphs and sandbox badge",
      zh: "高对比度 Signal Powerline 预设，含 Nerd 图标与沙箱状态",
    },
  },
  {
    name: "compact",
    tags: ["minimal"],
    summary: {
      en: "Compact ASCII pipes with model, git, legacy bar and state",
      zh: "紧凑竖线分隔 ASCII 预设，含模型、Git、进度条与状态",
    },
  },
  {
    name: "bracket",
    tags: ["minimal"],
    summary: {
      en: "Bracketed Unicode pills in Paper palette",
      zh: "Paper 配色方括号分区预设（Unicode 图标）",
    },
  },
  {
    name: "focus-legacy",
    tags: ["minimal", "context"],
    summary: {
      en: "Legacy single-row ASCII layout with 5-cell context bar",
      zh: "经典单行 ASCII 布局，配 5 格上下文进度条",
    },
  },
];

const BUILTIN_NAMES = new Set(Object.keys(PRESETS));

export function presetTitle(name, language = "en") {
  if (name === "focus-legacy") return "Focus (legacy)";
  if (name === "author") return language === "zh" ? "作者同款" : "Author";
  const text = String(name ?? "");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export function slugifyPresetName(text) {
  let out = "";
  for (const ch of String(text ?? "").trim().toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      out += ch;
    } else if ((ch === " " || ch === "-" || ch === "_" || ch === ".") && out && !out.endsWith("-")) {
      out += "-";
    }
  }
  while (out.endsWith("-")) out = out.slice(0, -1);
  return out;
}

export function presetNameProblem(slug, existingMineNames = [], { allowSameAs = null, language = "en" } = {}) {
  const zh = language === "zh";
  if (!slug) {
    return zh ? "请输入预设名称。" : "Give it a name.";
  }
  if ([...slug].length > PRESET_NAME_MAX) {
    return zh ? `名称不能超过 ${PRESET_NAME_MAX} 个字符。` : `Keep the name to ${PRESET_NAME_MAX} characters.`;
  }
  if (BUILTIN_NAMES.has(slug)) {
    return zh ? `${slug} 是内置预设名，请换一个名称。` : `${slug} is a built-in preset; pick another name.`;
  }
  if (slug !== allowSameAs && existingMineNames.includes(slug)) {
    return zh ? `已有 ${slug} 预设，按 W 可覆盖它。` : `You already have ${slug}; W on it replaces it.`;
  }
  return null;
}

export function derivePresetTags(preferences) {
  const rows = presetRows(preferences);
  const segs = preferences.segments ?? [];
  const tags = ["mine"];
  if (rows.length > 1) tags.push("multi-line");
  if (preferences.skin === "powerline") tags.push("powerline");
  if (segs.some((id) => id === "quota" || id.startsWith("quota."))) tags.push("quota");
  if (segs.includes("cache")) tags.push("cache");
  if (segs.includes("context")) tags.push("context");
  if (rows.length === 1 && segs.length <= 4 && preferences.skin === "plain") tags.push("minimal");
  return tags;
}

export function isPresetInUse(currentPrefs, entry) {
  if (!currentPrefs || !entry) return false;
  if (currentPrefs.customPreset) {
    return entry.origin === "mine" && entry.name === currentPrefs.customPreset;
  }
  return entry.origin === "builtin" && entry.name === currentPrefs.preset;
}

export function matchesPreset(currentPrefs, entry) {
  if (!currentPrefs || !entry || !entry.preferences) return false;
  const target = entry.preferences;
  const styleKeys = ["theme", "skin", "icons", "colorDepth", "contextFormat", "quotaPace", "dirStyle"];
  for (const key of styleKeys) {
    if (currentPrefs[key] !== target[key]) return false;
  }
  if (currentPrefs.segments.join(",") !== target.segments.join(",")) return false;
  const curSig = layoutSignature(currentPrefs);
  const tgtSig = layoutSignature(target);
  if (curSig !== tgtSig) return false;
  return itemSignature(currentPrefs) === itemSignature(target);
}

function layoutSignature(prefs) {
  return presetRows(prefs).map((row) => `${row.left.length}:${row.right.length}`).join(",");
}

function itemSignature(prefs) {
  const native = Boolean(PRESETS[prefs.preset]?.rows);
  const rows = presetRows(prefs);
  const byMetric = new Map(rows.flatMap((row) => [...row.left, ...row.right].map((item) => [item.metric, item])));
  return prefs.segments.map((id) => {
    const item = byMetric.get(id) ?? { metric: id };
    const widget = defaultWidgetFor(id, item, { native, icons: prefs.icons, preset: prefs.preset });
    const icon = item.icon != null ? item.icon : (prefs.icons === "nerd" && item.nerd_icon != null ? item.nerd_icon : "");
    const format = item.format ?? "";
    const bar = item.bar ?? "";
    const cells = item.cells ?? "";
    return `${id}=${widget}|${icon}|${format}|${bar}|${cells}`;
  }).join(";");
}

export function applyPreset(currentPrefs, entry, part = "all") {
  const target = entry.preferences;
  if (part === "all") {
    return normalizePreferences({
      ...target,
      ...(entry.origin === "mine" ? { customPreset: entry.name } : {}),
    });
  }
  if (part === "style") {
    return normalizePreferences({
      ...currentPrefs,
      theme: target.theme,
      skin: target.skin,
      icons: target.icons,
      colorDepth: target.colorDepth,
    });
  }
  // part === "layout"
  const targetRows = presetRows(target);
  const counts = targetRows.map((row) => [row.left.length, row.right.length]);
  const singleLeftOnly = counts.length <= 1 && (counts[0]?.[1] ?? 0) === 0;
  let layout;
  if (
    currentPrefs.preset === target.preset
    && presetHasStructuredLayout(currentPrefs.preset)
    && target.layout === "preset"
  ) {
    layout = "preset";
  } else {
    layout = singleLeftOnly ? "flat" : counts;
  }

  const targetNative = Boolean(PRESETS[target.preset]?.rows);
  const currentNative = Boolean(PRESETS[currentPrefs.preset]?.rows);
  const nextItems = {};

  for (const row of targetRows) {
    for (const item of [...row.left, ...row.right]) {
      const id = item.metric;
      const curBase = presetBaseItem(currentPrefs, id);
      const override = {};

      const targetWidget = defaultWidgetFor(id, item, {
        native: targetNative,
        icons: target.icons,
        preset: target.preset,
      });
      const currentDefaultWidget = defaultWidgetFor(id, curBase, {
        native: currentNative,
        icons: currentPrefs.icons,
        preset: currentPrefs.preset,
      });
      const allowedWidgets = ITEM_WIDGETS[id] ?? ["text"];
      if ((item.widget != null || targetWidget !== currentDefaultWidget) && allowedWidgets.includes(targetWidget)) {
        if (targetWidget !== currentDefaultWidget) override.widget = targetWidget;
      }

      const targetIcon = item.icon != null ? item.icon : (currentPrefs.icons === "nerd" ? item.nerd_icon : undefined);
      const curBaseIcon = curBase.icon != null ? curBase.icon : (currentPrefs.icons === "nerd" ? curBase.nerd_icon : undefined);
      if (targetIcon != null && targetIcon !== curBaseIcon) {
        override.icon = targetIcon;
      } else if (targetIcon == null && curBaseIcon != null) {
        override.icon = resolveIcon({ metric: id }, id, { icons: currentPrefs.icons, native: currentNative });
      }

      if (item.format && item.format !== curBase.format) {
        override.format = item.format;
      } else if (!item.format && curBase.format) {
        const fallbackFormat = id === "context"
          ? (currentNative ? "{pct}%[ · {tokens}]" : "{pct}%")
          : ITEM_FORMAT_PRESETS[id]?.[0];
        if (fallbackFormat && fallbackFormat !== curBase.format) {
          override.format = fallbackFormat;
        }
      }

      if (Object.keys(override).length > 0) {
        nextItems[id] = override;
      }
    }
  }

  const next = {
    ...currentPrefs,
    segments: target.segments.slice(),
    layout,
  };
  if (Object.keys(nextItems).length > 0) next.items = nextItems;
  else delete next.items;
  return normalizePreferences(next);
}

export class PresetLibrary {
  constructor(dir = null) {
    this.dir = dir;
    this.generation = 0;
    this.lastChanged = null;
    this._memory = new Map();
    this._entries = [];
    this.refresh();
  }

  entries() {
    return this._entries;
  }

  filtered(filterId = "all") {
    if (!filterId || filterId === "all") return this._entries;
    return this._entries.filter((entry) => entry.tags.includes(filterId));
  }

  get(name) {
    return this._entries.find((entry) => entry.name === name) ?? null;
  }

  mineNames() {
    return this._entries.filter((entry) => entry.origin === "mine").map((entry) => entry.name);
  }

  refresh() {
    const mine = [];
    if (this.dir) {
      let names = [];
      try {
        names = readdirSync(this.dir);
      } catch {
        names = [];
      }
      for (const fileName of names) {
        if (!fileName.endsWith(".json")) continue;
        const slug = fileName.slice(0, -5);
        if (!slug || BUILTIN_NAMES.has(slug)) continue;
        const filePath = path.join(this.dir, fileName);
        let mtimeMs = null;
        try {
          mtimeMs = statSync(filePath).mtimeMs;
        } catch {
          mtimeMs = null;
        }
        try {
          const parsed = JSON.parse(readFileSync(filePath, "utf8"));
          const rawPrefs = parsed?.preferences ?? parsed;
          const preferences = normalizePreferences({ ...rawPrefs, customPreset: slug });
          const summary = sanitizeText(parsed?.summary ?? "").trim();
          mine.push({
            name: slug,
            title: presetTitle(slug),
            origin: "mine",
            filePath,
            mtimeMs,
            summary: { en: summary, zh: summary },
            tags: derivePresetTags(preferences),
            preferences,
            error: null,
          });
        } catch (error) {
          mine.push({
            name: slug,
            title: presetTitle(slug),
            origin: "mine",
            filePath,
            mtimeMs,
            summary: { en: "", zh: "" },
            tags: ["mine"],
            preferences: null,
            error: sanitizeText(error?.message || "invalid preset file"),
          });
        }
      }
    } else {
      for (const [slug, record] of this._memory.entries()) {
        mine.push({
          name: slug,
          title: presetTitle(slug),
          origin: "mine",
          filePath: null,
          mtimeMs: record.mtimeMs,
          summary: { en: record.summary, zh: record.summary },
          tags: derivePresetTags(record.preferences),
          preferences: record.preferences,
          error: null,
        });
      }
    }
    mine.sort((a, b) => a.name.localeCompare(b.name));

    const builtins = BUILTIN_PRESET_META.filter((meta) => PRESETS[meta.name]).map((meta) => ({
      name: meta.name,
      title: presetTitle(meta.name),
      origin: "builtin",
      filePath: null,
      mtimeMs: null,
      summary: meta.summary,
      tags: meta.tags.slice(),
      preferences: normalizePreferences({ preset: meta.name }),
      error: null,
    }));

    this._entries = [...mine, ...builtins];
    this.generation += 1;
  }

  create(rawName, rawSummary, preferences, { now = Date.now(), language = "en" } = {}) {
    const slug = slugifyPresetName(rawName);
    const problem = presetNameProblem(slug, this.mineNames(), { language });
    if (problem) return { ok: false, error: problem };
    const cleanSummary = sanitizeText(rawSummary ?? "").trim().slice(0, 120);
    const stored = normalizePreferences({ ...preferences, customPreset: slug });
    if (this.dir) {
      const filePath = path.join(this.dir, `${slug}.json`);
      writePresetAtomic(filePath, { name: slug, summary: cleanSummary, preferences: stored });
    } else {
      this._memory.set(slug, { name: slug, summary: cleanSummary, preferences: stored, mtimeMs: now });
    }
    this.lastChanged = slug;
    this.refresh();
    return { ok: true, name: slug, preferences: stored };
  }

  replace(name, preferences, { now = Date.now(), language = "en" } = {}) {
    const existing = this.get(name);
    if (!existing || existing.origin !== "mine") {
      return {
        ok: false,
        error: language === "zh" ? `${name} 不是自定义预设。` : `${name} isn't one of your presets.`,
      };
    }
    const summary = existing.summary.en ?? "";
    const stored = normalizePreferences({ ...preferences, customPreset: name });
    if (this.dir) {
      writePresetAtomic(existing.filePath, { name, summary, preferences: stored });
    } else {
      this._memory.set(name, { name, summary, preferences: stored, mtimeMs: now });
    }
    this.lastChanged = name;
    this.refresh();
    return { ok: true, name, preferences: stored };
  }

  rename(oldName, rawNewName, rawSummary, { now = Date.now(), language = "en" } = {}) {
    const existing = this.get(oldName);
    if (!existing || existing.origin !== "mine") {
      return {
        ok: false,
        error: language === "zh" ? `${oldName} 不是自定义预设。` : `${oldName} isn't one of your presets.`,
      };
    }
    if (!existing.preferences) {
      return {
        ok: false,
        error: language === "zh" ? `无法读取 ${oldName}：${existing.error}` : `Can't read ${oldName}: ${existing.error}`,
      };
    }
    const slug = slugifyPresetName(rawNewName);
    const problem = presetNameProblem(slug, this.mineNames(), { allowSameAs: oldName, language });
    if (problem) return { ok: false, error: problem };
    const cleanSummary = sanitizeText(rawSummary ?? "").trim().slice(0, 120);
    const stored = normalizePreferences({ ...existing.preferences, customPreset: slug });
    if (this.dir) {
      const targetPath = path.join(this.dir, `${slug}.json`);
      writePresetAtomic(targetPath, { name: slug, summary: cleanSummary, preferences: stored });
      if (targetPath !== existing.filePath) {
        rmSync(existing.filePath, { force: true });
      }
    } else {
      if (slug !== oldName) this._memory.delete(oldName);
      this._memory.set(slug, { name: slug, summary: cleanSummary, preferences: stored, mtimeMs: now });
    }
    this.lastChanged = slug;
    this.refresh();
    return { ok: true, oldName, name: slug, preferences: stored };
  }

  delete(name, { language = "en" } = {}) {
    const existing = this.get(name);
    if (!existing || existing.origin !== "mine") {
      return {
        ok: false,
        error: language === "zh" ? `${name} 不是自定义预设。` : `${name} isn't one of your presets.`,
      };
    }
    if (this.dir) {
      rmSync(existing.filePath, { force: true });
    } else {
      this._memory.delete(name);
    }
    this.lastChanged = null;
    this.refresh();
    return { ok: true, name };
  }
}

export function formatEditedAgo(mtimeMs, nowMs = Date.now(), language = "en") {
  if (mtimeMs == null || !Number.isFinite(mtimeMs)) return "";
  const secs = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000));
  if (language === "zh") {
    if (secs < 60) return "刚刚编辑";
    if (secs < 3_600) return `${Math.floor(secs / 60)}分钟前编辑`;
    if (secs < 86_400) return `${Math.floor(secs / 3_600)}小时前编辑`;
    return `${Math.floor(secs / 86_400)}天前编辑`;
  }
  if (secs < 60) return "edited just now";
  if (secs < 3_600) return `edited ${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `edited ${Math.floor(secs / 3_600)}h ago`;
  return `edited ${Math.floor(secs / 86_400)}d ago`;
}

function writePresetAtomic(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, filePath);
}
