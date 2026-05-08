/**
 * Resolve plan with unblock loop — TPDC v2.
 *
 * Parallel to resolve-intake.ts but keyed off plan blockers instead of
 * intake openQuestions. When plan reports `readiness !== "ready"` with
 * non-empty blockers, the loop emits `tpdc/plan.unblock_requested`,
 * hibernates on `tpdc/plan.unblocked`, and re-runs plan with the
 * resolutions appended to the user input.
 *
 * Plan blockers shape `{ description, resolution? }` differs from intake's
 * Q&A shape, so the answer payload is `{ blocker, resolution }[]` (the
 * blocker's description echoed verbatim + the human's resolution).
 *
 * Closes TODO #3 (plan unblock not implemented).
 */

import { runPlan, type PlanResult } from "../../../stages/plan/plan.js";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../../stages/plan/plan.schema.js";
import type { PlanResolution } from "../../../schemas/events.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_UNBLOCK_TIMEOUT = "1d";

export interface ResolvePlanOptions {
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type is heavily generic
  step: any;
  runId: string;
  intake: IntakeArtifact;
  maxAttempts?: number;
  unblockTimeout?: string;
}

export type ResolvePlanResult =
  | {
      kind: "ready";
      artifact: PlanArtifact;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    }
  | {
      kind: "halted";
      reason: string;
      lastArtifact?: PlanArtifact;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    };

export async function resolvePlanWithUnblock(
  opts: ResolvePlanOptions,
): Promise<ResolvePlanResult> {
  const { step, runId, intake } = opts;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const unblockTimeout = opts.unblockTimeout ?? DEFAULT_UNBLOCK_TIMEOUT;

  let additionalContext: string | undefined;
  let totalIn = 0;
  let totalOut = 0;
  let lastArtifact: PlanArtifact | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const plan: PlanResult = await step.run(
      `plan-attempt-${attempt}`,
      async () => {
        return runPlan({ runId, intake, additionalContext });
      },
    );

    totalIn += plan.usage.inputTokens;
    totalOut += plan.usage.outputTokens;
    lastArtifact = plan.artifact;

    if (plan.artifact.readiness === "ready") {
      // Plan can also be "ready" with empty steps, which the workflow
      // already handles separately. Here we just delegate.
      return {
        kind: "ready",
        artifact: plan.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    if (plan.artifact.readiness === "not_ready") {
      return {
        kind: "halted",
        reason: "plan reported not_ready (intake itself needs more work)",
        lastArtifact: plan.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    // needs_input — only loop if there are blockers to ask about
    if (plan.artifact.blockers.length === 0) {
      // needs_input but no blockers? Treat as ready with the steps as-is.
      return {
        kind: "ready",
        artifact: plan.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    if (attempt === maxAttempts) {
      return {
        kind: "halted",
        reason: `plan still has ${plan.artifact.blockers.length} blocker(s) after ${maxAttempts} attempt(s)`,
        lastArtifact: plan.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    // Emit unblock request — visible in Inngest UI
    await step.sendEvent(`emit-plan-unblock-${attempt}`, {
      name: "tpdc/plan.unblock_requested",
      data: {
        runId,
        attempt,
        blockers: plan.artifact.blockers.map((b) => ({
          description: b.description,
          resolution: b.resolution,
        })),
      },
    });

    // Hibernate until the CLI fires the unblocked event
    const unblock = await step.waitForEvent(`wait-plan-unblock-${attempt}`, {
      event: "tpdc/plan.unblocked",
      timeout: unblockTimeout,
      if: `event.data.runId == "${runId}"`,
    });

    if (!unblock) {
      return {
        kind: "halted",
        reason: `plan unblock timeout after ${unblockTimeout} on attempt ${attempt}`,
        lastArtifact: plan.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    additionalContext = formatResolutions(unblock.data.resolutions);
  }

  return {
    kind: "halted",
    reason: "exhausted max attempts (unreachable)",
    lastArtifact,
    attempts: maxAttempts,
    totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
  };
}

function formatResolutions(resolutions: PlanResolution[]): string {
  const lines = ["## Resolutions for previous attempt's blockers", ""];
  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i]!;
    lines.push(`### Blocker ${i + 1}`);
    lines.push(`> ${r.blocker.trim()}`);
    lines.push(``);
    lines.push(`**Resolution:** ${r.resolution.trim()}`);
    lines.push(``);
  }
  lines.push(
    `Take these resolutions into account: produce a plan that incorporates them. Mark readiness=ready if all blockers are addressed.`,
  );
  return lines.join("\n");
}
