/**
 * Open-PR stage types — TPDC v2.
 *
 * Stage 6: open a Pull Request via gh CLI with title and body auto-generated
 * from intake + plan + execute + tests.
 */

import type { ExecuteResult } from "../execute/execute.schema.js";
import type { IntakeArtifact } from "../intake/intake.schema.js";
import type { PlanArtifact } from "../plan/plan.schema.js";
import type { RunTestsResult } from "../run-tests/run-tests.schema.js";

export interface OpenPRRequest {
  runId: string;
  /** Absolute path to the user's repo (used as cwd for gh). */
  repoRoot: string;
  /** Branch name that was pushed (head ref of the PR). */
  branch: string;
  /** Base branch the PR targets. Default "main". */
  baseBranch?: string;
  /** Artifacts used to render the PR body. */
  intake: IntakeArtifact;
  plan: PlanArtifact;
  execute: ExecuteResult;
  /** Test results. Omit on WIP paths (agent halted with partial work). */
  tests?: RunTestsResult;
  /** Open as draft. Default false. */
  draft?: boolean;
  /**
   * If set, the PR body renders a WIP warning at the top with this reason.
   * Used when the agent halted mid-execution but produced a coherent partial
   * change (TPDC bug #4 from dogfooding ronda 1).
   */
  wipReason?: string;
  /** Per-command timeout. Default 60s. */
  timeoutMs?: number;
}

export type OpenPRStatus =
  /** PR was created and we got back a URL. */
  | "opened"
  /** gh CLI is not installed (PATH miss or auth missing). */
  | "gh_missing"
  /** gh exited non-zero (auth, branch protection, duplicate PR, etc.). */
  | "failed"
  /** gh was killed by signal/timeout. */
  | "errored";

export interface OpenPRResult {
  runId: string;
  status: OpenPRStatus;
  /** Final URL of the opened PR. Empty when not opened. */
  prUrl: string;
  /** PR number parsed from the URL. -1 when not opened. */
  prNumber: number;
  branch: string;
  baseBranch: string;
  /** PR title sent to gh. */
  title: string;
  /** PR body sent to gh (markdown). Captured for audit/debugging. */
  body: string;
  /** Stdout from gh (typically the URL). */
  stdout: string;
  /** Stderr (errors, warnings). */
  stderr: string;
  exitCode: number;
  durationMs: number;
  errorMessage?: string;
}
