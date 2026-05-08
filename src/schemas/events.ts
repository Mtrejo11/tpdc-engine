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
