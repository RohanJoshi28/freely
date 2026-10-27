import { invoke } from "@tauri-apps/api/core";
import type { GenerationProfile } from "@/config";
import type { ThinkingLevel } from "@/lib/storage";

/** Settings a pre-started `claude` process is launched with (see agents.rs) */
export interface ClaudeLaunch {
  model?: string;
  effort?: string;
  tools?: string;
  allowedTools?: string[];
}

/**
 * The launch settings a call with this profile will request. Must resolve the
 * model the same way fetchAIResponse does, or the warm process won't match.
 */
export const claudeLaunchFor = (
  profile: GenerationProfile,
  effort: ThinkingLevel,
  variables: Record<string, string> | undefined,
): ClaudeLaunch => ({
  model: profile.model || variables?.MODEL || variables?.model || undefined,
  effort,
  tools: profile.tools,
  allowedTools: profile.allowedTools,
});

/** Keep these Claude Code processes started and waiting (Claude Code only) */
export const prewarmClaude = (launches: ClaudeLaunch[]) =>
  invoke("prewarm_claude", { launches }).catch((err) =>
    console.warn("Could not pre-start Claude Code:", err),
  );

export const clearClaudePool = () =>
  invoke("clear_claude_pool").catch(() => {});
