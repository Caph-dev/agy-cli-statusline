// Data adapted from CCometixLine 2.0.1 (MIT). See THIRD_PARTY_NOTICES.md.
const palette = (light, colors, segments) => ({ light, colors, segments });

export const CCLINE_PALETTES = {
  "terminal": palette(false, {
    "ok": "16:2", "warn": "16:3", "crit": "16:1", "accent": "16:14", "muted": "16:8",
    "onfill": "16:0", "identity": "16:14", "workspace": "16:10", "vcs": "16:12", "context": "16:13",
    "quota": "16:6", "cost": "16:3", "cache": "16:4", "session": "16:2", "timing": "16:5",
    "activity": "16:11", "system": "16:8", "separator": "16:7",
  }),
  "catppuccin-mocha": palette(false, {
    "ok": "#a6e3a1", "warn": "#f9e2af", "crit": "#f38ba8", "accent": "#89b4fa", "muted": "#6c7086",
    "text": "#cdd6f4", "bg": "#1e1e2e", "onfill": "#11111b", "identity": "#b4befe", "workspace": "#94e2d5",
    "vcs": "#74c7ec", "context": "#cba6f7", "quota": "#fab387", "cost": "#f9e2af", "cache": "#89dceb",
    "session": "#f5c2e7", "timing": "#f2cdcd", "activity": "#eba0ac", "system": "#7f849c", "separator": "16:7",
  }),
  "catppuccin-latte": palette(true, {
    "ok": "#40a02b", "warn": "#df8e1d", "crit": "#d20f39", "accent": "#1e66f5", "muted": "#9ca0b0",
    "text": "#4c4f69", "bg": "#eff1f5", "onfill": "#eff1f5", "identity": "#7287fd", "workspace": "#179299",
    "vcs": "#209fb5", "context": "#8839ef", "quota": "#fe640b", "cost": "#df8e1d", "cache": "#04a5e5",
    "session": "#ea76cb", "timing": "#dd7878", "activity": "#e64553", "system": "#8c8fa1", "separator": "#9ca0b0",
  }),
  "dracula": palette(false, {
    "ok": "#50fa7b", "warn": "#ffb86c", "crit": "#ff5555", "accent": "#bd93f9", "muted": "#6272a4",
    "text": "#f8f8f2", "bg": "#282a36", "onfill": "#282a36", "identity": "#bd93f9", "workspace": "#50fa7b",
    "vcs": "#8be9fd", "context": "#ff79c6", "quota": "#ffb86c", "cost": "#f1fa8c", "cache": "#8be9fd",
    "session": "#ff79c6", "timing": "#bd93f9", "activity": "#ffb86c", "system": "#6272a4", "separator": "16:7",
  }),
  "nord": palette(false, {
    "ok": "#a3be8c", "warn": "#ebcb8b", "crit": "#bf616a", "accent": "#88c0d0", "muted": "#4c566a",
    "text": "#d8dee9", "bg": "#2e3440", "onfill": "#2e3440", "identity": "#88c0d0", "workspace": "#a3be8c",
    "vcs": "#81a1c1", "context": "#b48ead", "quota": "#d08770", "cost": "#ebcb8b", "cache": "#8fbcbb",
    "session": "#5e81ac", "timing": "#b48ead", "activity": "#d08770", "system": "#616e88", "separator": "16:7",
  }),
  "tokyo-night": palette(false, {
    "ok": "#9ece6a", "warn": "#e0af68", "crit": "#f7768e", "accent": "#7aa2f7", "muted": "#565f89",
    "text": "#c0caf5", "bg": "#1a1b26", "onfill": "#1a1b26", "identity": "#7aa2f7", "workspace": "#9ece6a",
    "vcs": "#7dcfff", "context": "#bb9af7", "quota": "#ff9e64", "cost": "#e0af68", "cache": "#73daca",
    "session": "#bb9af7", "timing": "#2ac3de", "activity": "#ff9e64", "system": "#565f89", "separator": "16:7",
  }),
  "rose-pine": palette(false, {
    "ok": "#9ccfd8", "warn": "#f6c177", "crit": "#eb6f92", "accent": "#c4a7e7", "muted": "#6e6a86",
    "text": "#e0def4", "bg": "#191724", "onfill": "#191724", "identity": "#c4a7e7", "workspace": "#9ccfd8",
    "vcs": "#31748f", "context": "#ebbcba", "quota": "#f6c177", "cost": "#f6c177", "cache": "#9ccfd8",
    "session": "#ebbcba", "timing": "#c4a7e7", "activity": "#eb6f92", "system": "#908caa", "separator": "16:7",
  }),
  "gruvbox": palette(false, {
    "ok": "#b8bb26", "warn": "#fabd2f", "crit": "#fb4934", "accent": "#83a598", "muted": "#928374",
    "text": "#ebdbb2", "bg": "#282828", "onfill": "#282828", "identity": "#83a598", "workspace": "#b8bb26",
    "vcs": "#8ec07c", "context": "#d3869b", "quota": "#fe8019", "cost": "#fabd2f", "cache": "#8ec07c",
    "session": "#d3869b", "timing": "#83a598", "activity": "#fe8019", "system": "#928374", "separator": "16:7",
  }),
  "anthropic-clay": palette(false, {
    "ok": "#788c5d", "warn": "#d4a27f", "crit": "#bf4d43", "accent": "#d97757", "muted": "#87867f",
    "text": "#f0eee6", "bg": "#1f1e1d", "onfill": "#1f1e1d", "identity": "#d97757", "workspace": "#788c5d",
    "vcs": "#6a9bcc", "context": "#cc785c", "quota": "#d4a27f", "cost": "#d4a27f", "cache": "#6a9bcc",
    "session": "#c46686", "timing": "#87867f", "activity": "#cc785c", "system": "#87867f", "separator": "16:7",
  }),
  "powerline-dark": palette(false, {
    "ok": "#a3be8c", "warn": "#e5c07b", "crit": "#e06c75", "accent": "#61afef", "muted": "#5c6370",
    "text": "#d1d5db", "bg": "#1e1e1e", "onfill": "#ffffff", "identity": "#ffffff", "workspace": "#ffffff",
    "vcs": "#ffffff", "context": "#d1d5db", "quota": "#d1d5db", "cost": "#e5c07b", "cache": "#81a1c1",
    "session": "#a3be8c", "timing": "#81a1c1", "activity": "#e5c07b", "system": "#9ca3af", "separator": "16:7",
  }, {
    identity: ["#191b29", "#fca7ea"],
    workspace: ["#2f334d", "#82aaff"],
    vcs: ["#1e2030", "#c3e88d"],
    context: ["#3d59a1", "#c0caf5"],
    quota: ["#24283b", "#e0af68"],
    cost: ["#24283b", "#e0af68"],
    cache: ["#202334", "#7dcfff"],
    session: ["#292e42", "#9ece6a"],
    timing: ["#202334", "#bb9af7"],
    activity: ["#1e2030", "#ff9e64"],
    system: ["#191b29", "#565f89"],
    custom: ["#2f334d", "#7aa2f7"],
  }),
  "powerline-light": palette(true, {
    "ok": "#28a745", "warn": "#ffc107", "crit": "#dc3545", "accent": "#4fb3d9", "muted": "#6b7280",
    "text": "#1f2937", "bg": "#ffffff", "onfill": "#ffffff", "identity": "#0284c7", "workspace": "#ff6b47",
    "vcs": "#4fb3d9", "context": "#6b7280", "quota": "#28a745", "cost": "#b8860b", "cache": "#20c997",
    "session": "#28a745", "timing": "#20c997", "activity": "#ff6b47", "system": "#6b7280", "separator": "#6b7280",
  }, {
    identity: ["#191b29", "#fca7ea"],
    workspace: ["#2f334d", "#82aaff"],
    vcs: ["#1e2030", "#c3e88d"],
    context: ["#3d59a1", "#c0caf5"],
    quota: ["#24283b", "#e0af68"],
    cost: ["#24283b", "#e0af68"],
    cache: ["#202334", "#7dcfff"],
    session: ["#292e42", "#9ece6a"],
    timing: ["#202334", "#bb9af7"],
    activity: ["#1e2030", "#ff9e64"],
    system: ["#191b29", "#565f89"],
    custom: ["#2f334d", "#7aa2f7"],
  }),
  "powerline-rose-pine": palette(false, {
    "ok": "#9ccfd8", "warn": "#f6c177", "crit": "#eb6f92", "accent": "#c4a7e7", "muted": "#6e6a86",
    "text": "#e0def4", "bg": "#191724", "onfill": "#191724", "identity": "#ebbcba", "workspace": "#c4a7e7",
    "vcs": "#9ccfd8", "context": "#e0def4", "quota": "#f6c177", "cost": "#f6c177", "cache": "#9ccfd8",
    "session": "#9ccfd8", "timing": "#c4a7e7", "activity": "#eb6f92", "system": "#908caa", "separator": "16:7",
  }, {
    identity: ["#191b29", "#fca7ea"],
    workspace: ["#2f334d", "#82aaff"],
    vcs: ["#1e2030", "#c3e88d"],
    context: ["#3d59a1", "#c0caf5"],
    quota: ["#24283b", "#e0af68"],
    cost: ["#24283b", "#e0af68"],
    cache: ["#202334", "#7dcfff"],
    session: ["#292e42", "#9ece6a"],
    timing: ["#202334", "#bb9af7"],
    activity: ["#1e2030", "#ff9e64"],
    system: ["#191b29", "#565f89"],
    custom: ["#2f334d", "#7aa2f7"],
  }),
  "powerline-tokyo-night": palette(false, {
    "ok": "#9ece6a", "warn": "#e0af68", "crit": "#f7768e", "accent": "#7aa2f7", "muted": "#565f89",
    "text": "#c0caf5", "bg": "#1a1b26", "onfill": "#1a1b26", "identity": "#fca7ea", "workspace": "#82aaff",
    "vcs": "#c3e88d", "context": "#c0caf5", "quota": "#e0af68", "cost": "#e0af68", "cache": "#7dcfff",
    "session": "#9ece6a", "timing": "#bb9af7", "activity": "#ff9e64", "system": "#565f89", "separator": "16:7",
  }, {
    identity: ["#191b29", "#fca7ea"],
    workspace: ["#2f334d", "#82aaff"],
    vcs: ["#1e2030", "#c3e88d"],
    context: ["#3d59a1", "#c0caf5"],
    quota: ["#24283b", "#e0af68"],
    cost: ["#24283b", "#e0af68"],
    cache: ["#202334", "#7dcfff"],
    session: ["#292e42", "#9ece6a"],
    timing: ["#202334", "#bb9af7"],
    activity: ["#1e2030", "#ff9e64"],
    system: ["#191b29", "#565f89"],
    custom: ["#2f334d", "#7aa2f7"],
  }),
};

export const CCLINE_PRESETS = {
  "cometix": {
    "palette": "terminal", "skin": "plain", "glyphs": "nerd", "separator": " | ",
    line: [
      {
        left: [
          "model",
          {"metric": "dir", "icon_color": "bright_yellow"},
          "git",
          {"metric": "context", "widget": "gauge", "format": "{pct}%[ · {tokens} tokens]"},
          "cache",
        ],
        right: [
          "update",
        ],
      },
    ],
  },
  "minimal": {
    "palette": "terminal", "skin": "plain", "glyphs": "unicode", "separator": " · ",
    line: [
      {
        left: [
          {"metric": "model", "icon": ""},
          {"metric": "context", "widget": "text", "icon": "", "format": "{pct}%"},
          {"metric": "cache", "icon": "", "format": "[cache {left}][cache {cold}]"},
          {"metric": "cost", "icon": ""},
        ],
      },
    ],
  },
  "dashboard": {
    "palette": "catppuccin-mocha", "skin": "pill", "glyphs": "nerd",
    line: [
      {
        left: [
          "model",
          "dir",
          "git",
        ],
        right: [
          "update",
          "cost",
        ],
      },
      {
        left: [
          {"metric": "context", "bar": "eighths", "cells": 10},
          "context.trend",
          {"metric": "quota.5h", "cells": 8},
        ],
        right: [
          "cache",
        ],
      },
      {
        left: [
          "lines",
          "pr",
          "worktree",
        ],
        right: [
          "duration",
        ],
      },
    ],
  },
  "budget": {
    "palette": "tokyo-night", "skin": "plain", "glyphs": "nerd",
    line: [
      {
        left: [
          {"metric": "quota.5h", "cells": 10},
          {"metric": "quota.7d", "cells": 10},
          "quota.eta",
        ],
        right: [
          "cost",
          "cost.rate",
          "cost.today",
        ],
      },
      {
        left: [
          {"metric": "context", "bar": "blocks"},
          "context.to_compact",
          "cache",
        ],
      },
    ],
  },
  "cache-aware": {
    "palette": "rose-pine", "skin": "plain", "glyphs": "nerd", "separator": " · ",
    line: [
      {
        left: [
          "model",
          {"metric": "dir", "icon_color": "bright_yellow"},
          "git",
          {"metric": "context", "widget": "gauge"},
        ],
        right: [
          "update",
          "cost",
        ],
      },
      {
        left: [
          {"metric": "cache", "widget": "bar", "bar": "dots", "cells": 8, "format": "[warm {left}][{cold}]", "priority": 4},
          {"metric": "cache", "icon": "", "format": "[{hit}% hit][ · {misses}× miss][ · last: {cause}]", "compact": "[{hit}% hit][ · {misses}× miss]", "minimal": "[{hit}%]"},
        ],
        right: [
          "cost.rate",
        ],
      },
    ],
  },
  "focus": {
    "palette": "terminal", "skin": "plain", "glyphs": "unicode",
    line: [
      {
        left: [
          {"metric": "context", "bar": "eighths", "cells": 20, "coloring": "gradient", "priority": 5},
        ],
        right: [
          {"metric": "model", "priority": 2},
        ],
      },
      {
        left: [
          {"metric": "context.trend", "cells": 12},
          {"metric": "context.to_compact", "icon": "", "priority": 4},
        ],
        right: [
          "cache",
        ],
      },
    ],
  },
  "zen": {
    "palette": "terminal", "skin": "plain", "glyphs": "ascii", "color_depth": "none", "separator": " | ",
    line: [
      {
        left: [
          {"metric": "model", "compact": "{family}"},
          {"metric": "context", "widget": "text", "format": "ctx {pct}%"},
          {"metric": "cache", "format": "[cache {left}][cache {cold}]"},
          "cost",
        ],
      },
    ],
  },
  "powerline": {
    "palette": "powerline-tokyo-night", "skin": "powerline", "glyphs": "nerd",
    line: [
      {
        left: [
          "model",
          "dir",
          "git",
          {"metric": "context", "widget": "gauge"},
          "cache",
        ],
        right: [
          {"metric": "quota.5h", "widget": "gauge"},
          "cost",
        ],
      },
    ],
  },
};
