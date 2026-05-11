/**
 * tpdc_run_tests — heavy MCP tool for the run-tests stage.
 *
 * Runs the plan's `testCommands` array inside an existing worktree (created
 * earlier by `tpdc_execute`). Each command runs sequentially with a per-
 * command timeout. Returns aggregate status (all_passed / some_failed /
 * errored / no_commands) plus per-command stdout/stderr/exitCode.
 *
 * Deny-pattern guard inherits from the bash agent tool to prevent destructive
 * commands sneaking in via a malformed plan.
 */

import { z } from "zod";

import { runTests } from "../../stages/run-tests/run-tests.js";
import type { RunTestsRequest } from "../../stages/run-tests/run-tests.schema.js";
import type { ToolDefinition } from "./types.js";

const RunTestsInputSchema = z.object({
  runId: z.string().min(1),
  worktreePath: z.string().min(1),
  commands: z.array(z.string().min(1)),
  timeoutMs: z.number().int().min(1000).max(60 * 60 * 1000).optional(),
  maxBufferBytes: z.number().int().min(1024).optional(),
});

const DESCRIPTION =
  "Run the TPDC run-tests stage: execute each command in `commands` " +
  "sequentially inside `worktreePath`. Returns per-command result " +
  "(status: passed | failed | errored, exitCode, stdout, stderr, durationMs) " +
  "and an aggregate status (all_passed | some_failed | errored | no_commands). " +
  "Use AFTER tpdc_execute returned a worktreePath. Inputs: runId, worktreePath, " +
  "commands. Optional: timeoutMs per command (default 5min), maxBufferBytes " +
  "per stream (default 256KB).";

export const runTestsTool: ToolDefinition = {
  name: "tpdc_run_tests",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", description: "Run identifier (matches the one used in tpdc_execute)." },
      worktreePath: { type: "string", description: "Absolute path to the worktree (returned by tpdc_execute)." },
      commands: {
        type: "array",
        items: { type: "string" },
        description: "Test commands to run. Usually plan.testCommands.",
      },
      timeoutMs: { type: "number", description: "Per-command timeout in ms. Default 5min (300000). Range [1000, 3600000]." },
      maxBufferBytes: { type: "number", description: "Max bytes captured per stream. Default 262144 (256KB)." },
    },
    required: ["runId", "worktreePath", "commands"],
  },
  handler: async (args) => {
    const parsed = RunTestsInputSchema.safeParse(args);
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
    const req: RunTestsRequest = {
      runId: input.runId,
      worktreePath: input.worktreePath,
      commands: input.commands,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxBufferBytes !== undefined ? { maxBufferBytes: input.maxBufferBytes } : {}),
    };

    try {
      const result = await runTests(req);
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
              { ok: false, error: msg, stage: "run-tests", runId: input.runId },
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
