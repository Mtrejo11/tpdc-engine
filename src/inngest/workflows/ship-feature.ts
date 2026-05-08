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
import { runOpenPR } from "../../stages/open-pr/open-pr.js";
import { runPlan } from "../../stages/plan/plan.js";
import { runPush } from "../../stages/push/push.js";
import { runTests } from "../../stages/run-tests/run-tests.js";
import { inngest } from "../client.js";
import { resolveIntakeWithUnblock } from "./lib/resolve-intake.js";

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

    // ── Stage 2: Plan ────────────────────────────────────────────────
    // Take the intake and produce an ordered, executable plan.
    const plan = await step.run("plan", async () => {
      return await runPlan({
        runId: event.data.runId,
        intake: intake.artifact,
      });
    });

    logger.info("Plan complete", {
      runId: event.data.runId,
      readiness: plan.artifact.readiness,
      stepCount: plan.artifact.steps.length,
      riskLevel: plan.artifact.riskLevel,
      blockerCount: plan.artifact.blockers.length,
      tokensIn: plan.usage.inputTokens,
      tokensOut: plan.usage.outputTokens,
    });

    // Gate: plan must be ready and have steps to proceed.
    // Plan unblock loop is a future enhancement (blockers have a different
    // shape than intake openQuestions; design needs care).
    if (plan.artifact.readiness !== "ready") {
      return {
        status: plan.artifact.readiness === "not_ready" ? ("blocked" as const) : ("needs_input" as const),
        stage: "plan" as const,
        reason: `plan reported ${plan.artifact.readiness}`,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        blockers: plan.artifact.blockers,
      };
    }
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
    });

    if (execute.status !== "completed" && execute.status !== "no_changes") {
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

    // ── Stage 4: Run tests (validation) ──────────────────────────────
    // Execute plan.testCommands one by one in the worktree. all_passed is
    // required to proceed; some_failed/errored/no_commands halt cleanly so
    // a human (or stage 8's auto-fix-CI loop) can investigate.
    const tests = await step.run("run-tests", async () => {
      return await runTests({
        runId: event.data.runId,
        worktreePath: execute.worktreePath,
        commands: plan.artifact.testCommands,
      });
    });

    logger.info("Run-tests complete", {
      runId: event.data.runId,
      status: tests.status,
      ...tests.summary,
      totalDurationMs: tests.totalDurationMs,
    });

    if (tests.status !== "all_passed") {
      return {
        status: tests.status === "no_commands" ? ("blocked" as const) : ("failed" as const),
        stage: "run-tests" as const,
        reason:
          tests.status === "no_commands"
            ? "plan produced no testCommands; cannot validate programmatically"
            : `run-tests status: ${tests.status} (${tests.summary.failed} failed, ${tests.summary.errored} errored)`,
        runId: event.data.runId,
        intake: intake.artifact,
        plan: plan.artifact,
        execute,
        tests,
      };
    }

    // ── Stage 5: Push branch to remote + cleanup worktree ────────────
    // git push -u origin <branch>. On success, the worktree directory is
    // removed (branch ref stays for stage 8 auto-fix-CI re-creation).
    const push = await step.run("push", async () => {
      return await runPush({
        runId: event.data.runId,
        repoRoot: event.data.repoRoot,
        worktreePath: execute.worktreePath,
        branch: execute.branch,
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
        execute,
        tests,
        push,
      };
    }

    // ── Stage 6: Open PR via gh CLI ──────────────────────────────────
    // Title from intake.title; body rendered from intake + plan + execute + tests.
    const openPR = await step.run("open-pr", async () => {
      return await runOpenPR({
        runId: event.data.runId,
        repoRoot: event.data.repoRoot,
        branch: push.branch,
        intake: intake.artifact,
        plan: plan.artifact,
        execute,
        tests,
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
        execute,
        tests,
        push,
        openPR,
      };
    }

    // TODO: step.waitForEvent("tpdc/ci.completed", ...)  — stage 7
    // TODO: auto-fix-CI loop (evaluator-optimizer pattern) — stage 8

    return {
      status: "completed" as const,
      stage: "pr-opened" as const,
      runId: event.data.runId,
      intake: intake.artifact,
      plan: plan.artifact,
      execute,
      tests,
      push,
      openPR,
    };
  },
);
