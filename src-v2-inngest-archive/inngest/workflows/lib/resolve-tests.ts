/**
 * Resolve tests with auto-fix loop — TPDC v2 (stage 8 over local tests).
 *
 * Wraps the run-tests stage with the evaluator-optimizer pattern from
 * Anthropic's "Building effective agents" (research frente 3 §5):
 *
 *   loop up to maxRetries times:
 *     - run tests in the worktree
 *     - if all_passed → return success
 *     - if no_commands or errored → halt (no retry; not a test-failure issue)
 *     - if some_failed:
 *         - build FailureContext from the failed commands
 *         - run execute in fix-mode: reuses worktree, sees failures,
 *           makes a minimum-fix change, commits as a new commit
 *         - if fix produced no new changes → halt (agent stuck)
 *         - loop
 *
 * Each retry is its own Inngest step.run, so Inngest caches per-attempt
 * and the run shows the retry chain visibly in its UI.
 *
 * Reference: DECISIONS.md §"Decisiones derivadas" (evaluator-optimizer
 * pattern). This is the stage 8 baseline applied to local validation
 * before the equivalent loop on remote CI.
 */

import { runExecute } from "../../../stages/execute/execute.js";
import type {
  ExecuteResult,
  FailureContext,
} from "../../../stages/execute/execute.schema.js";
import type { WorktreeHandle } from "../../../stages/execute/worktree.js";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../../stages/plan/plan.schema.js";
import { runTests } from "../../../stages/run-tests/run-tests.js";
import type { RunTestsResult } from "../../../stages/run-tests/run-tests.schema.js";

const DEFAULT_MAX_RETRIES = 3;

export interface ResolveTestsOptions {
  /** Inngest step object from the workflow function context. */
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type is heavily generic; refine later
  step: any;
  runId: string;
  intake: IntakeArtifact;
  plan: PlanArtifact;
  /** The first execute result, before any retries. Worktree is already set up. */
  initialExecute: ExecuteResult;
  repoRoot: string;
  /** Max retries after the first run. Default 3. Total max attempts = maxRetries + 1. */
  maxRetries?: number;
}

export type ResolveTestsResult =
  | {
      kind: "passed";
      finalExecute: ExecuteResult;
      finalTests: RunTestsResult;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    }
  | {
      kind: "halted";
      reason: string;
      finalExecute: ExecuteResult;
      finalTests: RunTestsResult;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    };

export async function resolveTestsWithAutoFix(
  opts: ResolveTestsOptions,
): Promise<ResolveTestsResult> {
  const { step, runId, intake, plan, repoRoot } = opts;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  let currentExecute = opts.initialExecute;
  // initialExecute already accumulated tokens; track only added retry usage here.
  let extraIn = 0;
  let extraOut = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const tests: RunTestsResult = await step.run(
      `run-tests-attempt-${attempt}`,
      async () => {
        return runTests({
          runId,
          worktreePath: currentExecute.worktreePath,
          commands: plan.testCommands,
        });
      },
    );

    if (tests.status === "all_passed") {
      return {
        kind: "passed",
        finalExecute: currentExecute,
        finalTests: tests,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // no_commands or errored → halt without retry. These aren't "test failures"
    // we can fix by editing code; they're config or infra issues.
    if (tests.status === "no_commands" || tests.status === "errored") {
      return {
        kind: "halted",
        reason:
          tests.status === "no_commands"
            ? "plan produced no testCommands; cannot validate programmatically"
            : `tests errored (signal/timeout/infra): ${tests.summary.errored}/${tests.summary.total} commands could not run`,
        finalExecute: currentExecute,
        finalTests: tests,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // some_failed
    if (attempt === maxRetries) {
      return {
        kind: "halted",
        reason: `tests still failing after ${maxRetries} fix attempt(s) (${tests.summary.failed} failed of ${tests.summary.total})`,
        finalExecute: currentExecute,
        finalTests: tests,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // Build failure context and run another execute in fix-mode
    const failureContext: FailureContext = {
      attempt: attempt + 1,
      previousCommands: tests.results
        .filter((r) => r.status === "failed")
        .map((r) => ({
          command: r.command,
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
        })),
      previousFinalSummary: currentExecute.finalSummary,
    };

    const handle: WorktreeHandle = {
      path: currentExecute.worktreePath,
      branch: currentExecute.branch,
      baseSha: currentExecute.baseSha,
    };

    const fixExecute: ExecuteResult = await step.run(
      `execute-fix-attempt-${attempt + 1}`,
      async () => {
        return runExecute({
          runId,
          intakeTitle: intake.title,
          plan,
          repoRoot,
          existingWorktree: handle,
          failureContext,
          commitMessage: `fix(attempt ${attempt + 1}): address failing tests\n\nGenerated by TPDC v2 (run ${runId})`,
        });
      },
    );

    extraIn += fixExecute.usage.inputTokens;
    extraOut += fixExecute.usage.outputTokens;

    // No-progress guard: if the fix attempt didn't commit anything new and
    // didn't change the file set, the agent is stuck. Don't loop forever.
    const fixMadeChanges =
      fixExecute.commitSha !== undefined ||
      fixExecute.filesChanged.length > currentExecute.filesChanged.length;

    if (fixExecute.status !== "completed" || !fixMadeChanges) {
      return {
        kind: "halted",
        reason:
          fixExecute.status !== "completed"
            ? `fix attempt ${attempt + 1} ended with status=${fixExecute.status}`
            : `fix attempt ${attempt + 1} produced no new changes; agent appears stuck`,
        finalExecute: fixExecute,
        finalTests: tests,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    currentExecute = fixExecute;
  }

  // Defensive fallthrough — the maxRetries check inside the loop should cover this.
  return {
    kind: "halted",
    reason: "exhausted retries (defensive fallthrough)",
    finalExecute: currentExecute,
    finalTests: {
      runId,
      status: "errored",
      results: [],
      totalDurationMs: 0,
      summary: { total: 0, passed: 0, failed: 0, errored: 0 },
    },
    attempts: maxRetries + 1,
    totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
  };
}

function addUsage(
  initial: ExecuteResult,
  extraIn: number,
  extraOut: number,
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: initial.usage.inputTokens + extraIn,
    outputTokens: initial.usage.outputTokens + extraOut,
  };
}
