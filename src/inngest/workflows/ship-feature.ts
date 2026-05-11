/**
 * The "ship a feature" workflow — TPDC v2's main pipeline.
 *
 * Stages (placeholders; bodies fill in as each stage lands):
 *   intake (with unblock loop) → plan → execute (worktree) → run-tests
 *   → push → open-PR → wait-CI → auto-fix-CI → done (PR open + CI green)
 *
 * Hibernates at:
 *   - step.waitForEvent("tpdc/intake.unblocked", ...) inside resolveIntakeWithUnblock
 *   - step.waitForEvent("tpdc/ci.completed", ...) after PR open (TODO)
 *
 * See DECISIONS.md §D4 for the v2 scope boundary.
 */

import { runExecute } from "../../stages/execute/execute.js";
import { detectBaseBranch } from "../../stages/open-pr/detect-base-branch.js";
import { runOpenPR } from "../../stages/open-pr/open-pr.js";
import { runPush } from "../../stages/push/push.js";
import { inngest } from "../client.js";
import { resolveCIWithAutoFix } from "./lib/resolve-ci.js";
import { resolveIntakeWithUnblock } from "./lib/resolve-intake.js";
import { resolvePlanWithUnblock } from "./lib/resolve-plan.js";
import { resolveTestsWithAutoFix } from "./lib/resolve-tests.js";

export const shipFeature = inngest.createFunction(
  {
    id: "ship-feature",
    name: "Ship a feature end-to-end",
    retries: 3,
  },
  { event: "tpdc/feature.requested" },
  async ({ event, step, logger }) => {
    logger.info("Workflow started", {
      runId: event.data.runId,
      request: event.data.request.slice(0, 80),
    });

    // ── Stage 1: Intake (with unblock loop) ──────────────────────────
    // Inside this helper: run intake → if needs_input, emit unblock_requested,
    // hibernate on waitForEvent for unblocked, augment & retry. Up to 3 attempts.
    const intake = await resolveIntakeWithUnblock({
      step,
      runId: event.data.runId,
      request: event.data.request,
      maxAttempts: event.data.intakeMaxAttempts,
    });

    if (intake.kind === "halted") {
      logger.info("Intake halted", {
        runId: event.data.runId,
        reason: intake.reason,
        attempts: intake.attempts,
      });
      return {
        status: "blocked" as const,
        stage: "intake" as const,
        reason: intake.reason,
        runId: event.data.runId,
        intake: intake.lastArtifact,
        attempts: intake.attempts,
        usage: intake.totalUsage,
      };
    }

    logger.info("Intake resolved", {
      runId: event.data.runId,
      readiness: intake.artifact.readiness,
      acCount: intake.artifact.acceptanceCriteria.length,
      attempts: intake.attempts,
      tokensIn: intake.totalUsage.inputTokens,
      tokensOut: intake.totalUsage.outputTokens,
    });

    // ── Stage 2: Plan (with unblock loop) ────────────────────────────
    // Inside the helper: run plan → if needs_input with blockers, emit
    // tpdc/plan.unblock_requested, hibernate on tpdc/plan.unblocked, augment
    // with resolutions and retry. Up to 3 attempts.
    const plan = await resolvePlanWithUnblock({
      step,
      runId: event.data.runId,
      intake: intake.artifact,
      maxAttempts: event.data.planMaxAttempts,
    });

    if (plan.kind === "halted") {
      logger.info("Plan halted", {
        runId: event.data.runId,
        reason: plan.reason,
        attempts: plan.attempts,
      });
      return {
        status: "blocked" as const,
        stage: "plan" as const,
        reason: plan.reason,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.lastArtifact,
        attempts: plan.attempts,
        usage: plan.totalUsage,
      };
    }

    logger.info("Plan resolved", {
      runId: event.data.runId,
      readiness: plan.artifact.readiness,
      stepCount: plan.artifact.steps.length,
      riskLevel: plan.artifact.riskLevel,
      attempts: plan.attempts,
      tokensIn: plan.totalUsage.inputTokens,
      tokensOut: plan.totalUsage.outputTokens,
    });

    if (plan.artifact.steps.length === 0) {
      return {
        status: "blocked" as const,
        stage: "plan" as const,
        reason: "plan reported ready but produced zero steps",
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
      };
    }

    // ── Stage 3: Execute (agentic, worktree-isolated) ────────────────
    // Agent loop with bash + text_editor tools scoped to a fresh worktree.
    // Produces a diff against the base commit. Does NOT run tests yet
    // (that's stage 4). Does NOT push or merge (stages 5-6).
    //
    // The repoRoot is taken from the triggering event payload. The worktree
    // lives under <repoRoot>/.tpdc/worktrees/<runId>/.
    const execute = await step.run("execute", async () => {
      return await runExecute({
        runId: event.data.runId,
        intakeTitle: intake.artifact.title,
        plan: plan.artifact,
        repoRoot: event.data.repoRoot,
        // Mid-flight observability: emit one event per tool invocation
        // so progress is visible in Inngest UI without polling the
        // worktree filesystem (TPDC bug #3 from dogfooding ronda 1).
        onToolCall: async (e) => {
          await inngest.send({
            name: "tpdc/execute.tool_call",
            data: {
              runId: event.data.runId,
              turn: e.turn,
              toolName: e.toolName,
              toolInputPreview: e.toolInputPreview,
              phase: "initial",
            },
          });
        },
      });
    });

    logger.info("Execute complete", {
      runId: event.data.runId,
      status: execute.status,
      filesChanged: execute.filesChanged.length,
      turnCount: execute.turnCount,
      toolCalls: execute.toolCallCount,
      tokensIn: execute.usage.inputTokens,
      tokensOut: execute.usage.outputTokens,
      finalSummary: execute.finalSummary?.slice(0, 500),
    });

    // WIP recovery path: agent ran out of turns but produced a coherent partial
    // change worth human review. Skip tests + CI auto-fix (the work is incomplete
    // by definition; running validation would just generate noise) and go straight
    // to push + draft PR with a visible warning. (TPDC bug #4 from dogfooding.)
    const isWipPath =
      execute.status === "max_turns_exceeded" && execute.commitSha !== undefined;

    if (
      execute.status !== "completed" &&
      execute.status !== "no_changes" &&
      !isWipPath
    ) {
      return {
        status: "blocked" as const,
        stage: "execute" as const,
        reason: `execute status: ${execute.status}`,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        execute,
      };
    }

    // ── Stage 4 + 8: Run tests with auto-fix loop ───────────────────
    // Run plan.testCommands. If they fail, dispatch a fix-mode execute
    // with the failure output, retry, up to maxRetries (default 3).
    // Each attempt is its own Inngest step.run for visibility.
    // See DECISIONS.md "evaluator-optimizer pattern".
    //
    // Skipped on WIP path — tests against incomplete work are meaningless.
    let finalExecute = execute;
    let tests: import("../../stages/run-tests/run-tests.schema.js").RunTestsResult | undefined;

    if (!isWipPath) {
      const testsResolved = await resolveTestsWithAutoFix({
        step,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        initialExecute: execute,
        repoRoot: event.data.repoRoot,
      });

      logger.info("Tests resolved", {
        runId: event.data.runId,
        kind: testsResolved.kind,
        attempts: testsResolved.attempts,
        tokensIn: testsResolved.totalUsage.inputTokens,
        tokensOut: testsResolved.totalUsage.outputTokens,
      });

      if (testsResolved.kind === "halted") {
        const reasonContains = testsResolved.reason.toLowerCase();
        const isInfra =
          reasonContains.includes("no testcommands") ||
          reasonContains.includes("errored") ||
          reasonContains.includes("appears stuck");
        return {
          status: isInfra ? ("blocked" as const) : ("failed" as const),
          stage: "run-tests" as const,
          reason: testsResolved.reason,
          runId: event.data.runId,
          intake: intake.artifact,
          plan: plan.artifact,
          execute: testsResolved.finalExecute,
          tests: testsResolved.finalTests,
          attempts: testsResolved.attempts,
          finalSummary: testsResolved.finalExecute.finalSummary?.slice(0, 500),
        };
      }

      // Tests passed. Use the final execute (which may be a fix-mode commit).
      finalExecute = testsResolved.finalExecute;
      tests = testsResolved.finalTests;
    }

    // ── Stage 5: Push branch to remote + cleanup worktree ────────────
    // git push -u origin <branch>. On success, the worktree directory is
    // removed (branch ref stays for stage 8 auto-fix-CI re-creation).
    const push = await step.run("push", async () => {
      return await runPush({
        runId: event.data.runId,
        repoRoot: event.data.repoRoot,
        worktreePath: finalExecute.worktreePath,
        branch: finalExecute.branch,
      });
    });

    logger.info("Push complete", {
      runId: event.data.runId,
      status: push.status,
      branch: push.branch,
      worktreeRemoved: push.worktreeRemoved,
      durationMs: push.durationMs,
    });

    if (push.status !== "pushed") {
      return {
        status: push.status === "errored" ? ("failed" as const) : ("blocked" as const),
        stage: "push" as const,
        reason: `push status: ${push.status}${push.stderr ? ` — ${push.stderr.slice(0, 200)}` : ""}`,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        execute: finalExecute,
        tests,
        push,
      };
    }

    // ── Stage 6: Open PR via gh CLI ──────────────────────────────────
    // Title from intake.title; body rendered from intake + plan + execute + tests.
    // Auto-detect the base branch (some repos use master/develop instead of main).
    const baseBranchInfo = await step.run("detect-base-branch", async () => {
      return await detectBaseBranch({ repoRoot: event.data.repoRoot });
    });

    const openPR = await step.run("open-pr", async () => {
      return await runOpenPR({
        runId: event.data.runId,
        repoRoot: event.data.repoRoot,
        branch: push.branch,
        baseBranch: baseBranchInfo.branch,
        intake: intake.artifact,
        plan: plan.artifact,
        execute: finalExecute,
        tests,
        // On WIP path: open as draft with a visible warning so the human knows
        // the change is incomplete and validation was skipped.
        draft: isWipPath,
        wipReason: isWipPath
          ? `Agent halted at max_turns (${finalExecute.turnCount} turns / ${finalExecute.toolCallCount} tool calls)`
          : undefined,
      });
    });

    logger.info("Open-PR complete", {
      runId: event.data.runId,
      status: openPR.status,
      prNumber: openPR.prNumber,
      prUrl: openPR.prUrl,
      durationMs: openPR.durationMs,
    });

    if (openPR.status !== "opened") {
      return {
        status: openPR.status === "errored" ? ("failed" as const) : ("blocked" as const),
        stage: "open-pr" as const,
        reason: `open-pr status: ${openPR.status}${openPR.errorMessage ? ` — ${openPR.errorMessage}` : ""}`,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        execute: finalExecute,
        tests,
        push,
        openPR,
      };
    }

    // WIP path early return: the draft PR is the final outcome. CI auto-fix
    // would just churn against partial work — let the human take over.
    if (isWipPath) {
      return {
        status: "completed" as const,
        stage: "wip-pr-opened" as const,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        execute: finalExecute,
        push,
        openPR,
        wipReason: `agent halted at max_turns (${finalExecute.turnCount} turns / ${finalExecute.toolCallCount} tool calls)`,
        finalSummary: finalExecute.finalSummary?.slice(0, 500),
      };
    }

    // ── Stage 7 + 8 (remote): wait for CI + auto-fix CI failures ─────
    // Workflow hibernates on tpdc/ci.completed (emitted by the GitHub
    // webhook receiver). On failure, fetch CI logs, fix-mode execute,
    // push --force-with-lease, re-wait. Up to 3 retries.
    const ci = await resolveCIWithAutoFix({
      step,
      runId: event.data.runId,
      intake: intake.artifact,
      plan: plan.artifact,
      initialExecute: finalExecute,
      initialPush: push,
      repoRoot: event.data.repoRoot,
    });

    logger.info("CI resolved", {
      runId: event.data.runId,
      kind: ci.kind,
      attempts: ci.attempts,
      tokensIn: ci.totalUsage.inputTokens,
      tokensOut: ci.totalUsage.outputTokens,
    });

    if (ci.kind === "halted") {
      return {
        status: "failed" as const,
        stage: "ci" as const,
        reason: ci.reason,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        execute: ci.finalExecute,
        tests,
        push,
        openPR,
        ci,
      };
    }

    return {
      status: "completed" as const,
      stage: "ci-green" as const,
      runId: event.data.runId,
      intake: intake.artifact,
      plan: plan.artifact,
      execute: ci.finalExecute,
      tests,
      push,
      openPR,
      ci,
    };
  },
);
