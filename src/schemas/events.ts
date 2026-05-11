/**
 * Inngest event schemas — TPDC v2.
 *
 * Each event that traverses the workflow engine is typed via Zod.
 * Events trigger workflows or wake hibernating workflows from
 * `step.waitForEvent(...)`.
 *
 * Conventions:
 *   - Event names use `tpdc/<domain>.<verb>` form.
 *   - All payloads include `runId` for cross-stage correlation.
 */

import { z } from "zod";

import { TeamMeetingResultSchema } from "../teams/schemas.js";

/**
 * Team-meeting mode (D6). Determines whether and when the team-of-agents
 * meeting fires during intake convergence.
 *
 * - "manual"  → never. Long human wait (default 1d) every attempt. Status quo.
 * - "auto"    → fires on the FIRST needs_input attempt. Skips human entirely.
 *               If meeting `escalateToHuman` or cap hit, falls back to long human wait.
 * - "hybrid"  → attempts 1..N use long human wait (1d). Attempt N+1 uses a
 *               short wait (default 30m); on timeout, the meeting fires.
 *               If meeting escalates or cap is hit, falls back to long wait.
 *
 * See `docs/team-of-agents-spec.md` §6 (modes) and §7 (integration flow).
 */
export const TeamMeetingModeSchema = z.enum(["manual", "auto", "hybrid"]);
export type TeamMeetingMode = z.infer<typeof TeamMeetingModeSchema>;

export const FeatureRequestedSchema = z.object({
  runId: z.string(),
  request: z.string().min(1),
  repoRoot: z.string(),
  requestedBy: z.string().optional(),
  /**
   * Override the default max attempts for the intake unblock loop on a
   * per-run basis. Lets the caller (CLI / MCP / future Web UI) bump it for
   * tasks that are known to be vague (e.g., visual UI tweaks) without
   * touching the global default. Range [1, 10] keeps cost bounded.
   */
  intakeMaxAttempts: z.number().int().min(1).max(10).optional(),
  /**
   * Override the default max attempts for the plan unblock loop on a
   * per-run basis. Same rationale as intakeMaxAttempts.
   */
  planMaxAttempts: z.number().int().min(1).max(10).optional(),
  /**
   * Mode for the team-of-agents meeting (D6). Default `hybrid`.
   * See `TeamMeetingModeSchema` for semantics.
   */
  teamMeetingMode: TeamMeetingModeSchema.optional(),
  /**
   * In hybrid mode, the team meeting fires after attempt N. Default 2.
   * For mode="auto" this is ignored (meeting fires on attempt 1).
   * For mode="manual" this is ignored (meeting never fires).
   * Range [1, 10] guards against pathological values.
   */
  teamMeetingNAttempts: z.number().int().min(1).max(10).optional(),
  /**
   * In hybrid mode, the short human wait before falling through to the
   * team meeting. Inngest timeout string format ("30m", "1h", etc.).
   * Default "30m".
   */
  teamMeetingHybridTimeout: z.string().optional(),
});
export type FeatureRequested = z.infer<typeof FeatureRequestedSchema>;

export const CiCompletedSchema = z.object({
  runId: z.string(),
  prNumber: z.number(),
  status: z.enum(["success", "failure", "cancelled"]),
  conclusion: z.string().optional(),
  failedJobs: z.array(z.string()).default([]),
  logsUrl: z.string().url().optional(),
});
export type CiCompleted = z.infer<typeof CiCompletedSchema>;

// ── Unblock loop events ──────────────────────────────────────────────
//
// When intake (or later, plan) reports `needs_input` with blocking questions,
// the workflow emits `<stage>.unblock_requested` and hibernates on
// `<stage>.unblocked`. The CLI/MCP `tpdc unblock` command sends the
// `<stage>.unblocked` event with answers; the workflow wakes up and re-runs
// the stage with an augmented request.

const BlockingQuestionSchema = z.object({
  question: z.string(),
  owner: z.enum(["product", "engineering", "design", "user"]),
  blocking: z.boolean(),
});

export const IntakeUnblockRequestedSchema = z.object({
  runId: z.string(),
  attempt: z.number().int().min(1).describe("Which retry attempt this is (1-indexed)."),
  questions: z.array(BlockingQuestionSchema).min(1),
  originalRequest: z.string().describe("The request as originally submitted."),
});
export type IntakeUnblockRequested = z.infer<typeof IntakeUnblockRequestedSchema>;

export const UnblockAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});
export type UnblockAnswer = z.infer<typeof UnblockAnswerSchema>;

export const IntakeUnblockedSchema = z.object({
  runId: z.string(),
  answers: z.array(UnblockAnswerSchema).min(1),
});
export type IntakeUnblocked = z.infer<typeof IntakeUnblockedSchema>;

// ── Plan unblock events ──────────────────────────────────────────────
//
// Plan blockers have a different shape than intake openQuestions:
// each blocker is { description, resolution? } (the model says what's
// missing and what would unblock it). The user answers by providing a
// concrete resolution for each.

const PlanBlockerEchoSchema = z.object({
  description: z.string(),
  resolution: z.string(),
});

export const PlanUnblockRequestedSchema = z.object({
  runId: z.string(),
  attempt: z.number().int().min(1),
  blockers: z.array(PlanBlockerEchoSchema).min(1),
});
export type PlanUnblockRequested = z.infer<typeof PlanUnblockRequestedSchema>;

export const PlanResolutionSchema = z.object({
  /** The blocker's description (verbatim from PlanArtifact.blockers[].description). */
  blocker: z.string().min(1),
  /** What the human says to unblock it. */
  resolution: z.string().min(1),
});
export type PlanResolution = z.infer<typeof PlanResolutionSchema>;

export const PlanUnblockedSchema = z.object({
  runId: z.string(),
  resolutions: z.array(PlanResolutionSchema).min(1),
});
export type PlanUnblocked = z.infer<typeof PlanUnblockedSchema>;

/**
 * Team meeting completion event (D6). Emitted after a team-of-agents
 * meeting wraps, regardless of consensus/escalation outcome. Visible in
 * Inngest UI for mid-flight inspection and audit-after-the-fact. The
 * `result` payload carries the full `TeamMeetingResult`.
 */
export const TeamMeetingCompletedSchema = z.object({
  runId: z.string(),
  /** Which intake attempt triggered this meeting (1-indexed). */
  attempt: z.number().int().min(1),
  result: TeamMeetingResultSchema,
});
export type TeamMeetingCompleted = z.infer<typeof TeamMeetingCompletedSchema>;

/**
 * Mid-flight observability for the execute agent loop (TPDC bug #3 from
 * dogfooding ronda 1). Emitted once per tool invocation so the user can
 * watch progress in the Inngest UI without polling the worktree filesystem.
 */
export const ExecuteToolCallSchema = z.object({
  runId: z.string(),
  /** 1-indexed turn within the agent loop. */
  turn: z.number().int().min(1),
  /** Tool name (e.g., "bash", "str_replace_based_edit_tool"). */
  toolName: z.string(),
  /**
   * Truncated preview of the tool input (first ~200 chars). Lets a human
   * see *what* the agent is doing without dumping full file contents into
   * the event stream.
   */
  toolInputPreview: z.string(),
  /** Mode the execute is running in. "initial" by default, "fix" for retries. */
  phase: z.enum(["initial", "fix"]).default("initial"),
});
export type ExecuteToolCall = z.infer<typeof ExecuteToolCallSchema>;
