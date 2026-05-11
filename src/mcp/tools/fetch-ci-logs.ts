/**
 * tpdc_fetch_ci_logs — MCP wrapper over fetchCILogs.
 *
 * Pulls `gh run view --log-failed` for the most recent run on a branch.
 * Used by the auto-fix-CI loop to feed FailureContext into a fix-mode
 * execute.
 *
 * Returns { ok, runId?, logs, errorMessage? }. `ok=false` is a valid
 * outcome (e.g., gh missing) and does NOT flag isError on the MCP
 * response.
 */

import { z } from "zod";

import {
  fetchCILogs,
  type FetchCILogsRequest,
} from "../../stages/run-tests/fetch-ci-logs.js";
import type { ToolDefinition } from "./types.js";

const FetchCILogsInputSchema = z.object({
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  timeoutMs: z.number().int().min(1000).max(5 * 60 * 1000).optional(),
  maxLogChars: z.number().int().min(500).max(100_000).optional(),
});

const DESCRIPTION =
  "Fetch failed-job logs for the most recent workflow run on `branch`. " +
  "Wraps `gh run view --log-failed`. Returns { ok, runId?, logs, " +
  "errorMessage? }. `logs` is tail-preserved up to maxLogChars (default 8000). " +
  "Use AFTER tpdc_wait_ci returned status=completed with conclusion=failure " +
  "to gather context for tpdc_execute fix-mode.";

export const fetchCILogsTool: ToolDefinition = {
  name: "tpdc_fetch_ci_logs",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      repoRoot: { type: "string", description: "Absolute path to the user's repo (cwd for gh)." },
      branch: { type: "string", description: "Branch whose failed-run logs to pull." },
      timeoutMs: {
        type: "number",
        description: "Per-command timeout. Default 30000. Range [1000, 300000].",
      },
      maxLogChars: {
        type: "number",
        description: "Cap on log length (tail-preserved). Default 8000. Range [500, 100000].",
      },
    },
    required: ["repoRoot", "branch"],
  },
  handler: async (args) => {
    const parsed = FetchCILogsInputSchema.safeParse(args);
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
    const req: FetchCILogsRequest = {
      repoRoot: input.repoRoot,
      branch: input.branch,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxLogChars !== undefined ? { maxLogChars: input.maxLogChars } : {}),
    };

    try {
      const result = await fetchCILogs(req);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: msg, stage: "fetch-ci-logs" }, null, 2),
          },
        ],
        isError: true,
      };
    }
  },
};
