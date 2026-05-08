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

export const FeatureRequestedSchema = z.object({
  runId: z.string(),
  request: z.string().min(1),
  repoRoot: z.string(),
  requestedBy: z.string().optional(),
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
