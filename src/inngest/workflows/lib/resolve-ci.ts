/**
 * Resolve CI with auto-fix loop — TPDC v2 (stage 7 + 8 remote).
 *
 * After open-PR, the workflow hibernates on `step.waitForEvent("tpdc/ci.completed")`.
 * The GitHub webhook receiver (server.ts → /api/github/webhook) emits that
 * event when a check_suite completes for the run's branch.
 *
 * On success: return passed.
 * On failure: fetch CI logs via gh, dispatch a fix-mode execute with the
 *   logs as FailureContext, push --force-with-lease, re-wait. Up to maxRetries.
 * On timeout: halt.
 *
 * Parallels resolve-tests.ts (auto-fix over local tests). Generalization to
 * a single helper with pluggable validator is deferred to v2.x for clarity.
 *
 * Reference: DECISIONS.md §D4 (v2 = "PR open + CI green"). This closes D4.
 */

import { runExecute } from "../../../stages/execute/execute.js";
import type {
  ExecuteResult,
  FailureContext,
} from "../../../stages/execute/execute.schema.js";
import type { WorktreeHandle } from "../../../stages/execute/worktree.js";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../../stages/plan/plan.schema.js";
import { runPush } from "../../../stages/push/push.js";
import type { PushResult } from "../../../stages/push/push.schema.js";
import { fetchCILogs } from "../../../stages/run-tests/fetch-ci-logs.js";
import type { CiCompleted } from "../../../schemas/events.js";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CI_TIMEOUT = "1d";

export interface ResolveCIOptions {
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type is heavily generic
  step: any;
  runId: string;
  intake: IntakeArtifact;
  plan: PlanArtifact;
  /** Final execute result from before push (used as the starting point for fix retries). */
  initialExecute: ExecuteResult;
  /** Push result for the initial branch — confirms branch exists in remote. */
  initialPush: PushResult;
  repoRoot: string;
  /** Max fix retries after the first CI run. Default 3. */
  maxRetries?: number;
  /** Inngest timeout string for waiting on each CI completion. Default "1d". */
  ciTimeout?: string;
}

export type ResolveCIResult =
  | {
      kind: "passed";
      finalCi: CiCompleted;
      finalExecute: ExecuteResult;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    }
  | {
      kind: "halted";
      reason: string;
      finalCi?: CiCompleted;
      finalExecute: ExecuteResult;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    };

export async function resolveCIWithAutoFix(
  opts: ResolveCIOptions,
): Promise<ResolveCIResult> {
  const { step, runId, intake, plan, repoRoot } = opts;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const ciTimeout = opts.ciTimeout ?? DEFAULT_CI_TIMEOUT;

  let currentExecute = opts.initialExecute;
  let extraIn = 0;
  let extraOut = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Hibernate until the GitHub webhook fires for this runId.
    const ciEvent: { data: CiCompleted } | null = await step.waitForEvent(
      `wait-ci-attempt-${attempt}`,
      {
        event: "tpdc/ci.completed",
        timeout: ciTimeout,
        if: `event.data.runId == "${runId}"`,
      },
    );

    if (!ciEvent) {
      return {
        kind: "halted",
        reason: `CI did not complete within ${ciTimeout} on attempt ${attempt + 1}`,
        finalExecute: currentExecute,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    if (ciEvent.data.status === "success") {
      return {
        kind: "passed",
        finalCi: ciEvent.data,
        finalExecute: currentExecute,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // status === "failure" or "cancelled". Cancelled isn't a code-fix issue
    // — bail without retry.
    if (ciEvent.data.status === "cancelled") {
      return {
        kind: "halted",
        reason: "CI was cancelled (not retried automatically)",
        finalCi: ciEvent.data,
        finalExecute: currentExecute,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // failure — try to fix
    if (attempt === maxRetries) {
      return {
        kind: "halted",
        reason: `CI still failing after ${maxRetries} fix attempt(s)`,
        finalCi: ciEvent.data,
        finalExecute: currentExecute,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // 1. Fetch CI logs via gh CLI
    const logs = await step.run(`fetch-ci-logs-attempt-${attempt + 1}`, async () => {
      return fetchCILogs({
        repoRoot,
        branch: opts.initialPush.branch,
      });
    });

    // 2. Build FailureContext from CI logs (synthesize a single "command")
    const failureContext: FailureContext = {
      attempt: attempt + 1,
      previousCommands: [
        {
          command: `(GitHub CI on ${opts.initialPush.branch})`,
          exitCode: ciEvent.data.status === "failure" ? 1 : -1,
          stdout: logs.ok && logs.logs.length > 0 ? logs.logs : "(no failed-job logs available)",
          stderr: logs.errorMessage ?? "",
        },
      ],
      previousFinalSummary: currentExecute.finalSummary,
    };

    // 3. Re-execute in fix-mode reusing the worktree (re-create if removed by push cleanup)
    const handle: WorktreeHandle = {
      path: currentExecute.worktreePath,
      branch: currentExecute.branch,
      baseSha: currentExecute.baseSha,
    };

    const fixExecute: ExecuteResult = await step.run(
      `execute-fix-ci-attempt-${attempt + 1}`,
      async () => {
        return runExecute({
          runId,
          intakeTitle: intake.title,
          plan,
          repoRoot,
          existingWorktree: handle,
          failureContext,
          commitMessage: `fix(ci attempt ${attempt + 1}): address CI failures\n\nGenerated by TPDC v2 (run ${runId})`,
        });
      },
    );

    extraIn += fixExecute.usage.inputTokens;
    extraOut += fixExecute.usage.outputTokens;

    const fixMadeChanges =
      fixExecute.commitSha !== undefined ||
      fixExecute.filesChanged.length > currentExecute.filesChanged.length;

    if (fixExecute.status !== "completed" || !fixMadeChanges) {
      return {
        kind: "halted",
        reason:
          fixExecute.status !== "completed"
            ? `CI fix attempt ${attempt + 1} ended with status=${fixExecute.status}`
            : `CI fix attempt ${attempt + 1} produced no new changes; agent appears stuck`,
        finalCi: ciEvent.data,
        finalExecute: fixExecute,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    currentExecute = fixExecute;

    // 4. Push the new commit with --force-with-lease (the branch already exists remote).
    const fixPush = await step.run(`push-fix-ci-attempt-${attempt + 1}`, async () => {
      return runPush({
        runId,
        repoRoot,
        worktreePath: fixExecute.worktreePath,
        branch: fixExecute.branch,
        force: true,
      });
    });

    if (fixPush.status !== "pushed") {
      return {
        kind: "halted",
        reason: `CI fix attempt ${attempt + 1} push failed: ${fixPush.status}${fixPush.stderr ? ` — ${fixPush.stderr.slice(0, 200)}` : ""}`,
        finalCi: ciEvent.data,
        finalExecute: fixExecute,
        attempts: attempt + 1,
        totalUsage: addUsage(opts.initialExecute, extraIn, extraOut),
      };
    }

    // Loop: next iteration will waitForEvent for the NEW CI run triggered by this push.
  }

  // Defensive
  return {
    kind: "halted",
    reason: "exhausted retries (defensive fallthrough)",
    finalExecute: currentExecute,
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
