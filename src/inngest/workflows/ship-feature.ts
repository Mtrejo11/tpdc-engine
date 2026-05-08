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
        reason: "intake reported not_ready",
        runId: event.data.runId,
        intake: intake.artifact,
      };
    }
    const blocking = intake.artifact.openQuestions.filter((q) => q.blocking);
    if (intake.artifact.readiness === "needs_input" && blocking.length > 0) {
      return {
        status: "needs_input" as const,
        reason: `intake has ${blocking.length} blocking open question(s)`,
        runId: event.data.runId,
        intake: intake.artifact,
        blockingQuestions: blocking,
      };
    }

    // TODO: plan, execute (worktree), run-tests, push, open-PR
    // TODO: step.waitForEvent("tpdc/ci.completed", ...)
    // TODO: auto-fix-CI loop (evaluator-optimizer pattern)

    return {
      status: "stub" as const,
      runId: event.data.runId,
      intake: intake.artifact,
    };
  },
);
