/**
 * Execute stage types — TPDC v2.
 *
 * Note: unlike intake/plan, execute's "output" is observed via filesystem
 * effects (the worktree diff), not a single structured LLM response. So
 * this module exposes types/interfaces directly rather than Zod schemas
 * for structured outputs.
 */

import type { PlanArtifact } from "../plan/plan.schema.js";

export interface ExecuteRequest {
  runId: string;
  intakeTitle: string;
  plan: PlanArtifact;
  /** Absolute path to the user's repo. Worktrees go under <repoRoot>/.tpdc/worktrees/<runId>. */
  repoRoot: string;
  /** Override model. Defaults to Sonnet 4.6. */
  model?: string;
  /** Cap on agent loop turns. Default 30. */
  maxTurns?: number;
  /**
   * Override commit message used when the workflow commits the agent's
   * final state. If omitted, derived from `intakeTitle + runId`.
   */
  commitMessage?: string;
}

export type ExecuteStatus =
  | "completed"
  | "no_changes"
  | "max_turns_exceeded"
  | "tool_error_loop"
  | "model_refused";

export interface ExecuteResult {
  runId: string;
  status: ExecuteStatus;
  worktreePath: string;
  branch: string;
  baseSha: string;
  /**
   * SHA of the commit created by the workflow over the agent's final state.
   * Undefined when status=no_changes or when no commit was made (e.g., the
   * agent committed everything itself and there was nothing left to add).
   */
  commitSha?: string;
  /** Commit message used. Only set when commitSha is set. */
  commitMessage?: string;
  filesChanged: string[];
  diff: string;
  /** The model's last text response — typically a summary of what was done. */
  finalSummary: string;
  toolCallCount: number;
  turnCount: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** The model id Anthropic actually served. */
  model: string;
}
