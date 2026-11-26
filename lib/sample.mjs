/**
 * Sample payload for preview and the editor. Fields match the agy status-line
 * document; values are illustrative and never written to settings.
 */

export const SAMPLE_HOME = "/Users/ada";

export const SAMPLE_PAYLOAD = {
  cwd: "/Users/ada/src/atlas",
  model: { id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", effort: "high" },
  workspace: {
    current_dir: "/Users/ada/src/atlas",
    project_dir: "/Users/ada/src/atlas",
  },
  context_window: {
    used_percentage: 42,
    current_usage: { input_tokens: 83000, output_tokens: 1000, cache_read_input_tokens: 42000, cache_creation_input_tokens: 1200 },
    context_window_size: 200000,
  },
  prompt_cache: {
    warm: true,
    caching_observed: true,
    ttl: "5m",
    expires_in_seconds: 222,
    requests: 41,
    misses: 1,
    hit_ratio: 0.94,
    last_miss_cause: { causes: ["tools_changed"] },
    recache_tokens_if_cold: 124000,
    rewarm_usd: 0.47,
  },
  quota: [
    { id: "gemini-5h", label: "5h", remaining_fraction: 0.62, reset_in_seconds: 14500 },
    { id: "gemini-weekly", label: "weekly", remaining_fraction: 0.18, reset_in_seconds: 270000 },
  ],
  cost: { total_usd: 1.284 },
  cost_today: { total_usd: 8.42, calls: 42, conversations: 4 },
  tps: { rate: 84, ttft: 1.8, total: 11.6, median: 78, output_tokens: 974 },
  agent_state: { status: "editing" },
  subagents: [
    {
      name: "research",
      role: "Codebase Reviewer",
      model: "Gemini 4 Neon (High)",
      context_window: { used_percentage: 45, current_usage: { input_tokens: 120000 } },
      cache_hit: 97,
      cost_usd: 0.40,
      status: "running",
      duration_ms: 65_000,
      steps: 12,
    },
    {
      name: "explore",
      role: "Dependency Audit",
      model: "Gemini 4 Hydrogen",
      context_window: { used_percentage: 18, current_usage: { input_tokens: 45000 } },
      cache_hit: 92,
      cost_usd: 0.08,
      status: "completed",
      duration_ms: 100_000,
      steps: 9,
    },
  ],
  vcs: { type: "git" },
  cycle_mode: "agent",
  sandbox: { enabled: true },
  terminal_width: 88,
};

export const SAMPLE_GIT = {
  branch: "main",
  sha: "2f08999",
  detached: false,
  dirty: true,
  staged: 1,
  modified: 2,
  untracked: 1,
  conflicts: 0,
  ahead: 1,
  behind: 0,
  unborn: false,
  worktree: "atlas-feature",
};

export function samplePayload(width = SAMPLE_PAYLOAD.terminal_width) {
  return {
    ...SAMPLE_PAYLOAD,
    terminal_width: width,
    workspace: { ...SAMPLE_PAYLOAD.workspace },
    prompt_cache: { ...SAMPLE_PAYLOAD.prompt_cache },
    subagents: SAMPLE_PAYLOAD.subagents.map((entry) => ({
      ...entry,
      context_window: entry.context_window
        ? { ...entry.context_window, current_usage: { ...entry.context_window.current_usage } }
        : undefined,
    })),
  };
}
