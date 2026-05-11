/**
 * Resolve intake with unblock loop + team-of-agents (D6) — TPDC v2.
 *
 * Wraps `runIntake` with the unblock cycle, which now supports three modes
 * controlled by `teamMeetingMode`:
 *
 *   - "manual" → status-quo. Long human wait (default 1d) every needs_input.
 *   - "auto"   → on the FIRST needs_input, fire the team meeting. Skips humans.
 *                If the meeting `escalateToHuman` or the cap is hit, fall
 *                back to the long human wait.
 *   - "hybrid" (default) → attempts 1..N use long human wait. Attempt N+1
 *                uses short wait (default 30m); on timeout, team meeting
 *                fires. Single-shot cap; after the meeting, subsequent
 *                attempts fall back to long human wait.
 *
 * Crucial invariant: the team meeting fires AT MOST ONCE per call to this
 * function. The single-shot rule is enforced by the local `teamMeetingHasFired`
 * boolean. Inngest replay-safety: the variable is set AFTER the meeting's
 * `step.run(...)` resolves, so cached replay returns the same result and
 * leaves the variable set on the same logical line.
 *
 * See `docs/team-of-agents-spec.md` §6 (modes) and §7 (flow).
 * See `DECISIONS.md` §D6 (architectural decision).
 */

import { runIntake, type IntakeResult } from "../../../stages/intake/intake.js";
import type {
  IntakeArtifact,
  OpenQuestion,
} from "../../../stages/intake/intake.schema.js";
import type {
  TeamMeetingMode,
} from "../../../schemas/events.js";
import {
  runTeamMeeting,
  shouldIncludeDesigner,
  type Role,
  type TeamMeetingResult,
} from "../../../teams/team-meeting.js";
import {
  augmentRequestWithAnswers,
  augmentRequestWithTeamMeeting,
} from "./augment-request.js";

// Bumped from 3 to 5 in alpha.3 as defense-in-depth before the team-of-agents
// pivot kicks in (see DECISIONS.md §D6 + HANDOFF.md). For vague/visual tasks
// the intake agent recursively surfaces questions, so a higher cap reduces the
// false-halt rate. The real fix is the team meeting; this just buys headroom.
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_UNBLOCK_TIMEOUT = "1d";
const DEFAULT_TEAM_MEETING_MODE: TeamMeetingMode = "hybrid";
const DEFAULT_TEAM_MEETING_N = 2;
const DEFAULT_TEAM_MEETING_HYBRID_TIMEOUT = "30m";

export interface ResolveIntakeOptions {
  /** Inngest step object from the workflow function context. */
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type is heavily generic; refine later
  step: any;
  runId: string;
  /** Original request text from the user. */
  request: string;
  /** Max number of intake attempts (default 5). After this, halt. */
  maxAttempts?: number;
  /** Inngest timeout string for the LONG human wait (default "1d"). */
  unblockTimeout?: string;
  /** Team meeting mode (D6). Default "hybrid". */
  teamMeetingMode?: TeamMeetingMode;
  /** In hybrid mode, fire team meeting after attempt N. Default 2. */
  teamMeetingNAttempts?: number;
  /** Short wait before falling through to team in hybrid mode. Default "30m". */
  teamMeetingHybridTimeout?: string;
}

export type ResolveIntakeResult =
  | {
      kind: "ready";
      artifact: IntakeArtifact;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
      /** Set when a team meeting fired during resolution. */
      teamMeeting?: TeamMeetingResult;
    }
  | {
      kind: "halted";
      reason: string;
      lastArtifact?: IntakeArtifact;
      attempts: number;
      totalUsage: { inputTokens: number; outputTokens: number };
      /** Set when a team meeting fired during resolution (even if it didn't unblock). */
      teamMeeting?: TeamMeetingResult;
    };

// ── Strategy decision ────────────────────────────────────────────────

type UnblockStrategy =
  | { kind: "long_human_wait" }
  | { kind: "short_human_wait_then_team" }
  | { kind: "team_meeting_immediate" };

/**
 * Decide how to unblock a `needs_input` attempt. Pure function — easy to test.
 *
 * The single-shot rule (`teamMeetingHasFired`) takes precedence: once the
 * team has fired, every subsequent attempt falls back to the long human wait.
 */
export function decideUnblockStrategy(args: {
  mode: TeamMeetingMode;
  attempt: number;
  N: number;
  teamMeetingHasFired: boolean;
}): UnblockStrategy {
  const { mode, attempt, N, teamMeetingHasFired } = args;

  // Cap hit → always long human wait (fallback)
  if (teamMeetingHasFired) return { kind: "long_human_wait" };

  switch (mode) {
    case "manual":
      return { kind: "long_human_wait" };
    case "auto":
      // Fire team meeting immediately on the first needs_input
      return { kind: "team_meeting_immediate" };
    case "hybrid":
      if (attempt <= N) return { kind: "long_human_wait" };
      // attempt > N → short wait, fall through to team on timeout
      return { kind: "short_human_wait_then_team" };
  }
}

// ── Main entry point ────────────────────────────────────────────────

export async function resolveIntakeWithUnblock(
  opts: ResolveIntakeOptions,
): Promise<ResolveIntakeResult> {
  const { step, runId, request } = opts;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const longTimeout = opts.unblockTimeout ?? DEFAULT_UNBLOCK_TIMEOUT;
  const mode = opts.teamMeetingMode ?? DEFAULT_TEAM_MEETING_MODE;
  const N = opts.teamMeetingNAttempts ?? DEFAULT_TEAM_MEETING_N;
  const shortTimeout =
    opts.teamMeetingHybridTimeout ?? DEFAULT_TEAM_MEETING_HYBRID_TIMEOUT;

  let currentRequest = request;
  let totalIn = 0;
  let totalOut = 0;
  let lastArtifact: IntakeArtifact | undefined;
  let teamMeetingHasFired = false;
  let lastTeamMeeting: TeamMeetingResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const intake: IntakeResult = await step.run(
      `intake-attempt-${attempt}`,
      async () => runIntake({ runId, request: currentRequest }),
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
        teamMeeting: lastTeamMeeting,
      };
    }

    if (intake.artifact.readiness === "not_ready") {
      return {
        kind: "halted",
        reason: "intake reported not_ready (no recovery via clarifications)",
        lastArtifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
        teamMeeting: lastTeamMeeting,
      };
    }

    // readiness === "needs_input"
    const blocking: OpenQuestion[] = intake.artifact.openQuestions.filter(
      (q) => q.blocking,
    );
    if (blocking.length === 0) {
      // needs_input but nothing actually blocks — accept and continue
      return {
        kind: "ready",
        artifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
        teamMeeting: lastTeamMeeting,
      };
    }

    if (attempt === maxAttempts) {
      return {
        kind: "halted",
        reason: `intake still has ${blocking.length} blocking question(s) after ${maxAttempts} attempt(s)`,
        lastArtifact: intake.artifact,
        attempts: attempt,
        totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
        teamMeeting: lastTeamMeeting,
      };
    }

    const strategy = decideUnblockStrategy({
      mode,
      attempt,
      N,
      teamMeetingHasFired,
    });

    // ─── Apply strategy ───
    switch (strategy.kind) {
      case "long_human_wait": {
        const outcome = await doHumanUnblock({
          step,
          attempt,
          runId,
          blocking,
          originalRequest: request,
          timeout: longTimeout,
          stepIdPrefix: "unblock",
        });
        if (!outcome.ok) {
          return {
            kind: "halted",
            reason: `unblock timeout after ${longTimeout} on attempt ${attempt}`,
            lastArtifact: intake.artifact,
            attempts: attempt,
            totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
            teamMeeting: lastTeamMeeting,
          };
        }
        currentRequest = augmentRequestWithAnswers(request, outcome.answers);
        break;
      }

      case "short_human_wait_then_team": {
        // Hybrid: try human first with short timeout, fall through to team on timeout.
        const outcome = await doHumanUnblock({
          step,
          attempt,
          runId,
          blocking,
          originalRequest: request,
          timeout: shortTimeout,
          stepIdPrefix: "unblock-short",
        });
        if (outcome.ok) {
          // Human responded in time — use their answers, leave team meeting unused
          currentRequest = augmentRequestWithAnswers(request, outcome.answers);
          break;
        }
        // Timeout → fire team meeting (fallthrough)
        const meeting = await fireTeamMeeting({
          step,
          attempt,
          runId,
          originalRequest: request,
          intakeSoFar: intake.artifact,
          openQuestions: blocking,
        });
        teamMeetingHasFired = true;
        lastTeamMeeting = meeting;
        const next = await consumeMeetingOrEscalate({
          step,
          attempt,
          runId,
          meeting,
          blocking,
          originalRequest: request,
          longTimeout,
        });
        if (next === null) {
          return {
            kind: "halted",
            reason: `team escalated to human; unblock timeout after ${longTimeout} on attempt ${attempt}`,
            lastArtifact: intake.artifact,
            attempts: attempt,
            totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
            teamMeeting: lastTeamMeeting,
          };
        }
        currentRequest = next;
        break;
      }

      case "team_meeting_immediate": {
        // Auto mode: fire team meeting on first needs_input
        const meeting = await fireTeamMeeting({
          step,
          attempt,
          runId,
          originalRequest: request,
          intakeSoFar: intake.artifact,
          openQuestions: blocking,
        });
        teamMeetingHasFired = true;
        lastTeamMeeting = meeting;
        const next = await consumeMeetingOrEscalate({
          step,
          attempt,
          runId,
          meeting,
          blocking,
          originalRequest: request,
          longTimeout,
        });
        if (next === null) {
          return {
            kind: "halted",
            reason: `team escalated to human; unblock timeout after ${longTimeout} on attempt ${attempt}`,
            lastArtifact: intake.artifact,
            attempts: attempt,
            totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
            teamMeeting: lastTeamMeeting,
          };
        }
        currentRequest = next;
        break;
      }
    }
  }

  // Defensive: unreachable due to `attempt === maxAttempts` check above
  return {
    kind: "halted",
    reason: "exhausted max attempts (unreachable)",
    lastArtifact,
    attempts: maxAttempts,
    totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
    teamMeeting: lastTeamMeeting,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

type HumanUnblockOutcome =
  | { ok: true; answers: Array<{ question: string; answer: string }> }
  | { ok: false };

async function doHumanUnblock(args: {
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type
  step: any;
  attempt: number;
  runId: string;
  blocking: OpenQuestion[];
  originalRequest: string;
  timeout: string;
  stepIdPrefix: string;
}): Promise<HumanUnblockOutcome> {
  const { step, attempt, runId, blocking, originalRequest, timeout, stepIdPrefix } = args;

  await step.sendEvent(`emit-${stepIdPrefix}-${attempt}`, {
    name: "tpdc/intake.unblock_requested",
    data: {
      runId,
      attempt,
      questions: blocking,
      originalRequest,
    },
  });

  const unblock = await step.waitForEvent(`wait-${stepIdPrefix}-${attempt}`, {
    event: "tpdc/intake.unblocked",
    timeout,
    if: `event.data.runId == "${runId}"`,
  });

  if (!unblock) return { ok: false };
  return { ok: true, answers: unblock.data.answers };
}

/**
 * Derive which roles to convene for a team meeting. Designer is auto-skipped
 * when there's no UI/visual signal in the open questions or intake fields
 * (saves cost on non-UI tasks). PM + TechLead + Engineer are always included.
 *
 * Exported for testing.
 */
export function deriveRolesToConvene(
  blocking: ReadonlyArray<OpenQuestion>,
  intakeArtifact: IntakeArtifact,
): Role[] {
  const result: Role[] = ["PM", "TechLead"];
  if (shouldIncludeDesigner(blocking, intakeArtifact)) {
    result.push("Designer");
  }
  result.push("Engineer");
  return result;
}

async function fireTeamMeeting(args: {
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type
  step: any;
  attempt: number;
  runId: string;
  originalRequest: string;
  intakeSoFar: IntakeArtifact;
  openQuestions: OpenQuestion[];
}): Promise<TeamMeetingResult> {
  const { step, attempt, runId, originalRequest, intakeSoFar, openQuestions } = args;
  const rolesToConvene = deriveRolesToConvene(openQuestions, intakeSoFar);

  const meeting: TeamMeetingResult = await step.run(
    `team-meeting-${attempt}`,
    async () =>
      runTeamMeeting({
        runId,
        originalRequest,
        intakeSoFar,
        openQuestions,
        rolesToConvene,
      }),
  );

  // Observability: emit a completion event with the full result so the
  // Inngest UI / future audits can inspect what was decided.
  await step.sendEvent(`emit-team-meeting-completed-${attempt}`, {
    name: "tpdc/team-meeting.completed",
    data: {
      runId,
      attempt,
      result: meeting,
    },
  });

  return meeting;
}

/**
 * After a team meeting fires, decide what to do with its output:
 *   - If `escalateToHuman` is set: fall back to a long human wait, then
 *     use the human's answers (or return null on timeout to signal halt).
 *   - Otherwise: format the meeting result as an augmented request.
 *
 * Returns the next intake attempt's input, or null when the escalation
 * itself timed out and the workflow should halt.
 */
async function consumeMeetingOrEscalate(args: {
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step type
  step: any;
  attempt: number;
  runId: string;
  meeting: TeamMeetingResult;
  blocking: OpenQuestion[];
  originalRequest: string;
  longTimeout: string;
}): Promise<string | null> {
  const { step, attempt, runId, meeting, blocking, originalRequest, longTimeout } = args;

  if (meeting.escalateToHuman == null) {
    return augmentRequestWithTeamMeeting(originalRequest, meeting);
  }

  // Team punted to human — long wait fallback
  const outcome = await doHumanUnblock({
    step,
    attempt,
    runId,
    blocking,
    originalRequest,
    timeout: longTimeout,
    stepIdPrefix: "unblock-after-escalation",
  });

  if (!outcome.ok) return null;
  return augmentRequestWithAnswers(originalRequest, outcome.answers);
}
