/**
 * Sample payload for preview and the editor. Fields match the agy status-line
 * document; values are illustrative and never written to settings.
 */

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
  quota: [
    { id: "gemini-5h", label: "5h", remaining_fraction: 0.62, reset_in_seconds: 14500 },
    { id: "gemini-weekly", label: "weekly", remaining_fraction: 0.18, reset_in_seconds: 270000 },
  ],
  cost: { total_usd: 1.284 },
  agent_state: { status: "editing" },
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
  return { ...SAMPLE_PAYLOAD, terminal_width: width, workspace: { ...SAMPLE_PAYLOAD.workspace } };
}
