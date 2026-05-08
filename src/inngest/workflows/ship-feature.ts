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
    // TODO: real intake skill that produces a structured ticket.
    const intake = await step.run("intake", async () => {
      return {
        runId: event.data.runId,
        ticket: { problem: event.data.request },
        stage: "intake-stub",
      };
    });

    // TODO: plan, execute (worktree), run-tests, push, open-PR
    // TODO: step.waitForEvent("tpdc/ci.completed", ...)
    // TODO: auto-fix-CI loop (evaluator-optimizer pattern)

    return {
      status: "stub" as const,
      runId: event.data.runId,
      intake,
    };
  },
);
