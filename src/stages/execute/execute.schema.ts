/**
 * Execute stage types — TPDC v2.
 *
 * Note: unlike intake/plan, execute's "output" is observed via filesystem
 * effects (the worktree diff), not a single structured LLM response. So
 * this module exposes types/interfaces directly rather than Zod schemas
 * for structured outputs.
 */

import type { PlanArtifact } from "../plan/plan.schema.js";
import type { WorktreeHandle } from "./worktree.js";

/**
 * Context passed to a fix-mode execute run when the previous attempt's
 * tests failed. Built by the auto-fix loop (resolve-tests.ts).
 */
export interface FailureContext {
  /** 1-indexed retry attempt number. */
  attempt: number;
  /** Failed test commands with their output. Errored entries also included. */
  previousCommands: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  /** Final text summary from the previous execute (if any). */
  previousFinalSummary?: string;
}

export interface ExecuteRequest {
  runId: string;
  intakeTitle: string;
  plan: PlanArtifact;
  /** Absolute path to the user's repo. Worktrees go under <repoRoot>/.tpdc/worktrees/<runId>. */
  repoRoot: string;
  /** Override model. Defaults to Sonnet 4.6. */
  model?: string;
  /** Cap on agent loop turns. Default 60. */
  maxTurns?: number;
  /**
   * Override commit message used when the workflow commits the agent's
   * final state. If omitted, derived from `intakeTitle + runId`.
   */
  commitMessage?: string;
  /**
   * Reuse an existing worktree (e.g., for fix retries) instead of
   * creating a new one. When set, createWorktree is skipped.
   */
  existingWorktree?: WorktreeHandle;
  /**
   * When set, the executor enters fix-mode: the user input includes the
   * failing test commands + previous summary, and the system prompt is
   * augmented to focus on minimum-fix not re-implement.
   */
  failureContext?: FailureContext;
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
    /**
     * Tokens used to create cache entries this run, summed across turns.
     * Charged at 1.25x base input rate. Only present when prompt caching
     * is active (v0.4.0+); undefined on responses pre-cache-wireup.
     */
    cacheCreationInputTokens?: number;
    /**
     * Tokens served from cache this run, summed across turns. Charged at
     * 0.1x base input rate — this is where the savings live.
     */
    cacheReadInputTokens?: number;
    /**
     * Advisor invocation accounting (v0.4.0-alpha.5+).
     *
     * Counted from `server_tool_use` blocks named "advisor" in each turn's
     * response.content stream — that's the reliable source of truth.
     *
     * Token attribution is intentionally NOT surfaced here yet. The
     * platform's `usage.iterations` array doesn't carry a reliable origin
     * marker that distinguishes the main inference from advisor sub-calls,
     * so any per-call token figure would risk double-counting (which
     * dogfood-005's alpha.3 implementation hit). Total token cost is
     * already captured in `usage.inputTokens`/`outputTokens` at the parent
     * level; advisor-only attribution will come back when the platform
     * exposes it cleanly.
     *
     * **As of v0.4.0-alpha.11 this field is always present when execute
     * returns** (with `invocations: 0` when the tool didn't fire) — the
     * previous omit-when-zero pattern was ambiguous to readers. The TS
     * optional marker is kept for backward compatibility with results
     * persisted from earlier alphas.
     */
    advisor?: {
      /** Count of advisor calls summed across all turns of this run. */
      invocations: number;
    };
    /**
     * Web search invocation accounting (v0.4.0-alpha.7+).
     *
     * Counted from `server_tool_use` blocks named "web_search". Same caveat
     * as `advisor`: per-call token attribution is deferred until the
     * platform's iterations breakdown exposes a reliable origin marker.
     *
     * **Always present on v0.4.0-alpha.11+ results.** Optional marker kept
     * for backward compatibility with persisted pre-alpha.11 results.
     */
    webSearch?: {
      /** Count of web_search calls summed across all turns of this run. */
      invocations: number;
    };
    /**
     * Web fetch invocation accounting (v0.4.0-alpha.7+).
     *
     * Counted from `server_tool_use` blocks named "web_fetch". Same caveat
     * as `advisor`: per-call token attribution is deferred until the
     * platform's iterations breakdown exposes a reliable origin marker.
     *
     * **Always present on v0.4.0-alpha.11+ results.** Optional marker kept
     * for backward compatibility with persisted pre-alpha.11 results.
     */
    webFetch?: {
      /** Count of web_fetch calls summed across all turns of this run. */
      invocations: number;
    };
    /**
     * Context compaction events (v0.4.0-alpha.8+).
     *
     * Each event is a `BetaCompactionBlock` emitted by the platform when
     * the input-token trigger fires.
     *
     * **Disabled in v0.4.0-alpha.10+** — the platform rejected the
     * `compact_20260112` edit type when we tried to enable it during
     * dogfood-007. This field intentionally stays omit-when-zero (unlike
     * advisor/web) because zero events is the *structural default* of a
     * disabled capability, not a signal about agent behavior. When
     * context_management lands and we re-enable it (see execute.ts
     * hotfix comment), flip this to always-include alongside advisor/web.
     */
    compaction?: {
      /** Count of compaction blocks observed in the response stream. */
      events: number;
    };
  };
  /** The model id Anthropic actually served. */
  model: string;
}
