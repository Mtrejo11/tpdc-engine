/**
 * The "ship a feature" workflow — TPDC v2's main pipeline.
 *
 * Stages (placeholders; bodies fill in as each stage lands):
 *   intake → plan → execute (worktree) → run-tests → push → open-PR
 *   → wait-CI → auto-fix-CI → done (PR open + CI green)
 *
 * Hibernates at:
 *   - step.waitForEvent("tpdc/ci.completed", ...) after PR open
 *
 * See DECISIONS.md §D4 for the v2 scope boundary.
 */

import { runIntake } from "../../stages/intake/intake.js";
import { runPlan } from "../../stages/plan/plan.js";
import { inngest } from "../client.js";

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

    // ── Stage 1: Intake ──────────────────────────────────────────────
    // Convert the raw request into a structured IntakeArtifact.
    // Sonnet 4.6 + structured outputs (Zod schema enforced server-side).
    const intake = await step.run("intake", async () => {
      return await runIntake({
        runId: event.data.runId,
        request: event.data.request,
      });
    });

    logger.info("Intake complete", {
      runId: event.data.runId,
      readiness: intake.artifact.readiness,
      acCount: intake.artifact.acceptanceCriteria.length,
      openQuestions: intake.artifact.openQuestions.length,
      tokensIn: intake.usage.inputTokens,
      tokensOut: intake.usage.outputTokens,
    });

    // Gate: if intake says not_ready or has blocking open questions, halt.
    if (intake.artifact.readiness === "not_ready") {
      return {
        status: "blocked" as const,
        stage: "intake" as const,
        reason: "intake reported not_ready",
        runId: event.data.runId,
        intake: intake.artifact,
      };
    }
    const blocking = intake.artifact.openQuestions.filter((q) => q.blocking);
    if (intake.artifact.readiness === "needs_input" && blocking.length > 0) {
      return {
        status: "needs_input" as const,
        stage: "intake" as const,
        reason: `intake has ${blocking.length} blocking open question(s)`,
        runId: event.data.runId,
        intake: intake.artifact,
        blockingQuestions: blocking,
      };
    }

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
