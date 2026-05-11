/**
 * tpdc_wait_ci — heavy MCP tool that polls `gh run list` until the most
 * recent workflow run for `branch` reaches a terminal state, or maxWaitMs
 * elapses.
 *
 * Why polling: VISION.md §2 inmutable #1 — no webhook receiver, no server.
 * The agent calls this tool and waits. Backoff is exponential up to a cap;
 * total wait is bounded by maxWaitMs.
 *
 * Status results:
 *   - "completed" with `conclusion` (success / failure / cancelled / ...).
 *   - "timeout" if the bound was reached.
 *   - "errored" if gh failed 3+ times in a row (likely infra/auth).
 *
 * None of these flag `isError` on the MCP response — they're all valid
 * outcomes. `isError` is reserved for unexpected throws.
 */

import { z } from "zod";

import {
  waitCI,
  type WaitCIRequest,
} from "../../stages/wait-ci/wait-ci.js";
import type { ToolDefinition } from "./types.js";

const WaitCIInputSchema = z.object({
  runId: z.string().min(1),
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  headSha: z.string().min(1).optional(),
  pollIntervalMs: z.number().int().min(1000).max(60 * 1000).optional(),
  maxPollIntervalMs: z.number().int().min(1000).max(5 * 60 * 1000).optional(),
  maxWaitMs: z.number().int().min(10_000).max(2 * 60 * 60 * 1000).optional(),
  initialDelayMs: z.number().int().min(0).max(60 * 1000).optional(),
});

const DESCRIPTION =
  "Poll `gh run list` until the most recent workflow run for `branch` " +
  "reaches a terminal state. Returns { status: completed | timeout | " +
  "errored, conclusion?: success | failure | cancelled | ..., workflowName, " +
  "workflowRunId, url, sawAnyRun, pollCount, durationMs }. Polling is " +
  "exponential-backoff (default 5s → 30s cap, max total wait 30min). Use " +
  "AFTER tpdc_open_pr returned a PR. Optionally pass headSha to match a " +
  "specific commit run (useful after force-push retries).";

export const waitCITool: ToolDefinition = {
  name: "tpdc_wait_ci",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      repoRoot: { type: "string", description: "Absolute path to the user's repo." },
      branch: { type: "string", description: "Branch whose latest workflow run to wait on." },
      headSha: {
        type: "string",
        description: "Optional commit SHA. When set, only matches runs with this headSha (useful after force-push).",
      },
      pollIntervalMs: {
        type: "number",
        description: "Initial poll interval in ms. Default 5000. Range [1000, 60000].",
      },
      maxPollIntervalMs: {
        type: "number",
        description: "Cap on the poll interval after backoff. Default 30000. Range [1000, 300000].",
      },
      maxWaitMs: {
        type: "number",
        description: "Total wall-clock cap in ms. Default 1800000 (30min). Range [10000, 7200000].",
      },
      initialDelayMs: {
        type: "number",
        description: "Wait before the first poll (lets GH dispatch the run). Default 5000. Range [0, 60000].",
      },
    },
    required: ["runId", "repoRoot", "branch"],
  },
  handler: async (args) => {
    const parsed = WaitCIInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                errors: parsed.error.issues.map((i) => ({
                  path: i.path.map((s) => (typeof s === "number" ? String(s) : s)).join("."),
                  message: i.message,
                  code: i.code,
                })),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    const input = parsed.data;
    const req: WaitCIRequest = {
      runId: input.runId,
      repoRoot: input.repoRoot,
      branch: input.branch,
      ...(input.headSha !== undefined ? { headSha: input.headSha } : {}),
      ...(input.pollIntervalMs !== undefined ? { pollIntervalMs: input.pollIntervalMs } : {}),
      ...(input.maxPollIntervalMs !== undefined ? { maxPollIntervalMs: input.maxPollIntervalMs } : {}),
      ...(input.maxWaitMs !== undefined ? { maxWaitMs: input.maxWaitMs } : {}),
      ...(input.initialDelayMs !== undefined ? { initialDelayMs: input.initialDelayMs } : {}),
    };

    try {
      const result = await waitCI(req);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: false, error: msg, stage: "wait-ci", runId: input.runId },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  },
};
