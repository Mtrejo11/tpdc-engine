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

import { runPlan } from "../../stages/plan/plan.js";
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

    // TODO: execute (worktree), run-tests, push, open-PR
    // TODO: step.waitForEvent("tpdc/ci.completed", ...)
    // TODO: auto-fix-CI loop (evaluator-optimizer pattern)

    return {
      status: "stub" as const,
      stage: "post-plan" as const,
      runId: event.data.runId,
      intake: intake.artifact,
      plan: plan.artifact,
    };
  },
);
