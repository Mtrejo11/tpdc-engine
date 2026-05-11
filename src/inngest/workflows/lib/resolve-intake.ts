/**
 * Resolve intake with unblock loop — TPDC v2.
 *
 * Wraps `runIntake` with the unblock-and-retry cycle:
 *
 *   loop up to maxAttempts times:
 *     - run intake
 *     - if ready: return artifact
 *     - if not_ready: halt (no recovery via Q&A)
 *     - if needs_input with blocking questions:
 *         - emit `tpdc/intake.unblock_requested` with the questions
 *         - waitForEvent `tpdc/intake.unblocked` (workflow hibernates)
 *         - on resume, augment the request with the answers and retry
 *
 * Hibernation is the Inngest-native way to do this — `step.waitForEvent`
 * persists workflow state until the matching event arrives or the timeout
 * elapses. No polling, no side databases.
 *
 * The CLI/MCP `tpdc unblock <runId>` command fires the unblocked event.
 */

import { runIntake, type IntakeResult } from "../../../stages/intake/intake.js";
import type {
  IntakeArtifact,
  OpenQuestion,
} from "../../../stages/intake/intake.schema.js";
import { augmentRequestWithAnswers } from "./augment-request.js";

// Bumped from 3 to 5 in alpha.3 as defense-in-depth before the team-of-agents
// pivot kicks in (see DECISIONS.md §D6 + HANDOFF.md). For vague/visual tasks
// the intake agent recursively surfaces questions, so a higher cap reduces the
// false-halt rate. The real fix is the team meeting; this just buys headroom.
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_UNBLOCK_TIMEOUT = "1d";

export interface ResolveIntakeOptions {
  /** Inngest step object from the workflow function context. */
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type is heavily generic; refine later
  step: any;
  runId: string;
  /** Original request text from the user. */
  request: string;
  /** Max number of intake attempts (default 3). After this, halt. */
  maxAttempts?: number;
  /** Inngest timeout string for the unblock wait (default "1d"). */
  unblockTimeout?: string;
}

export type ResolveIntakeResult =
  | {
      kind: "ready";
      artifact: IntakeArtifact;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    }
  | {
      kind: "halted";
      reason: string;
      lastArtifact?: IntakeArtifact;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
    };

export async function resolveIntakeWithUnblock(
  opts: ResolveIntakeOptions,
): Promise<ResolveIntakeResult> {
  const { step, runId, request } = opts;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const unblockTimeout = opts.unblockTimeout ?? DEFAULT_UNBLOCK_TIMEOUT;

  let currentRequest = request;
  let totalIn = 0;
  let totalOut = 0;
  let lastArtifact: IntakeArtifact | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const intake: IntakeResult = await step.run(
      `intake-attempt-${attempt}`,
      async () => {
        return runIntake({ runId, request: currentRequest });
      },
    );

    totalIn += intake.usage.inputTokens;
    totalOut += intake.usage.outputTokens;
    lastArtifact = intake.artifact;

    if (intake.artifact.readiness === "ready") {
      return {
        kind: "ready",
        artifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    if (intake.artifact.readiness === "not_ready") {
      return {
        kind: "halted",
        reason: "intake reported not_ready (no recovery via clarifications)",
        lastArtifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    // needs_input — only loop if there are blocking questions to ask
    const blocking: OpenQuestion[] = intake.artifact.openQuestions.filter(
      (q: OpenQuestion) => q.blocking,
    );
    if (blocking.length === 0) {
      // Non-blocking needs_input: accept and continue
      return {
        kind: "ready",
        artifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    if (attempt === maxAttempts) {
      return {
        kind: "halted",
        reason: `intake still has ${blocking.length} blocking question(s) after ${maxAttempts} attempt(s)`,
        lastArtifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    // Emit unblock request — observable in Inngest UI
    await step.sendEvent(`emit-unblock-${attempt}`, {
      name: "tpdc/intake.unblock_requested",
      data: {
        runId,
        attempt,
        questions: blocking,
        originalRequest: request,
      },
    });

    // Hibernate until the CLI fires the unblocked event for this runId
    const unblock = await step.waitForEvent(`wait-unblock-${attempt}`, {
      event: "tpdc/intake.unblocked",
      timeout: unblockTimeout,
      if: `event.data.runId == "${runId}"`,
    });

    if (!unblock) {
      return {
        kind: "halted",
        reason: `unblock timeout after ${unblockTimeout} on attempt ${attempt}`,
        lastArtifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
      };
    }

    // Augment the request with answers and loop
    currentRequest = augmentRequestWithAnswers(request, unblock.data.answers);
  }

  // Defensive: should be unreachable due to attempt === maxAttempts check above
  return {
    kind: "halted",
    reason: "exhausted max attempts (unreachable)",
    lastArtifact,
    attempts: maxAttempts,
    totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
  };
}
