/**
 * GitHub webhook receiver — TPDC v2.
 *
 * Receives `check_suite.completed` events from GitHub, verifies HMAC,
 * extracts the runId from the branch name (convention: tpdc/run-<id>),
 * and emits `tpdc/ci.completed` to Inngest so the workflow can wake from
 * its `step.waitForEvent` hibernation.
 *
 * Setup:
 *   - In your repo's GitHub Settings → Webhooks → Add webhook:
 *     - Payload URL: <your dev/prod server>/api/github/webhook
 *     - Content type: application/json
 *     - Secret: same value as GITHUB_WEBHOOK_SECRET env var
 *     - Events: "Check suites"
 *
 *   For local dev, expose your Hono server with ngrok / cloudflared and
 *   point the webhook at the tunnel URL.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { CiCompletedSchema, type CiCompleted } from "../schemas/events.js";

/** Convention used by stage 3 createWorktree: tpdc/run-<runId>. */
const TPDC_BRANCH_RE = /^tpdc\/run-(.+)$/;

const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
]);

const SUCCESS_CONCLUSIONS = new Set(["success"]);

export type ParsedWebhookOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "emit"; event: { name: "tpdc/ci.completed"; data: CiCompleted } };

export interface CheckSuitePayload {
  action?: string;
  check_suite?: {
    head_branch?: string | null;
    conclusion?: string | null;
    status?: string | null;
    pull_requests?: Array<{ number?: number }>;
    html_url?: string;
  };
}

/**
 * Verifies the GitHub HMAC-SHA256 signature on the raw body.
 * GitHub sends "sha256=<hex>" in X-Hub-Signature-256.
 */
export function verifyGitHubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf-8").digest();
  const provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Extract the TPDC runId from a branch name; null if it doesn't match. */
export function extractRunIdFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null;
  const match = branch.match(TPDC_BRANCH_RE);
  return match ? (match[1] ?? null) : null;
}

/**
 * Parse a GitHub check_suite webhook payload into a TPDC outcome.
 *
 * Returns:
 *   - kind: "emit" with the event to send to Inngest, OR
 *   - kind: "ignored" with a reason (non-completed action, non-tpdc branch, etc.)
 */
export function parseCheckSuitePayload(
  body: CheckSuitePayload,
): ParsedWebhookOutcome {
  if (body.action !== "completed") {
    return { kind: "ignored", reason: `action=${body.action ?? "unknown"} (only 'completed' processed)` };
  }

  const cs = body.check_suite;
  if (!cs) {
    return { kind: "ignored", reason: "no check_suite in payload" };
  }

  const runId = extractRunIdFromBranch(cs.head_branch);
  if (!runId) {
    return { kind: "ignored", reason: `branch '${cs.head_branch}' is not a TPDC branch` };
  }

  const conclusion = cs.conclusion ?? "";
  let status: CiCompleted["status"];
  if (SUCCESS_CONCLUSIONS.has(conclusion)) {
    status = "success";
  } else if (FAILURE_CONCLUSIONS.has(conclusion)) {
    // Map both failure and cancelled to our event's "failure" / "cancelled" enum.
    // The event schema has only [success, failure, cancelled].
    status = conclusion === "cancelled" ? "cancelled" : "failure";
  } else {
    return { kind: "ignored", reason: `conclusion '${conclusion}' is not actionable` };
  }

  const prNumber = cs.pull_requests?.[0]?.number;
  if (typeof prNumber !== "number") {
    return { kind: "ignored", reason: "no associated PR number" };
  }

  // Validate against the schema (defensive; the cast above is best-effort).
  const data = CiCompletedSchema.parse({
    runId,
    prNumber,
    status,
    conclusion,
    failedJobs: [],  // populated lazily by resolve-ci.ts via `gh run view --log-failed`
    ...(cs.html_url ? { logsUrl: cs.html_url } : {}),
  });

  return {
    kind: "emit",
    event: { name: "tpdc/ci.completed", data },
  };
}
