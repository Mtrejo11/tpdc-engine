/**
 * tpdc_record_run_event — MCP wrapper around the recordRunEvent helper.
 *
 * Provides a Zod-validated, discriminated-union surface for orchestrating
 * skills (notably `/tpdc:ship`) to record what happened at each pipeline
 * stage. Each call appends one section to
 * `<repoRoot>/.tpdc/memory/runs/<runId>.md`.
 *
 * Why an MCP tool instead of relying on the executor's memory writes:
 *   - The executor agent may forget or partially comply with prompt
 *     instructions. A Zod-typed tool call cannot record a malformed
 *     summary — the validator rejects it before it touches disk.
 *   - The orchestrating skill (ship) is the canonical record-keeper,
 *     called once per stage with structured stage outputs. The
 *     prompt-driven path becomes a backup, not the primary contract.
 *
 * Returns `{ ok: true, path, created }` on success or `{ ok: false,
 * errors: [...] }` on validation failure (errors detail each invalid
 * field). Helper-level filesystem errors come back as `{ ok: false,
 * error: <message> }` with `isError: true`.
 */

import { z } from "zod";

import { recordRunEvent } from "../../runs/record-event.js";
import type { ToolDefinition } from "./types.js";

// ── Per-event payload schemas ────────────────────────────────────────

const ExecuteCompleteSchema = z.object({
  eventType: z.literal("execute_complete"),
  task: z.string().min(1),
  status: z.enum([
    "completed",
    "no_changes",
    "max_turns_exceeded",
    "tool_error_loop",
    "model_refused",
  ]),
  branch: z.string().min(1),
  filesChanged: z.array(z.string()),
  finalSummary: z.string(),
  toolCallCount: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
});

const TestsCompleteSchema = z.object({
  eventType: z.literal("tests_complete"),
  status: z.enum(["all_passed", "some_failed", "errored", "no_commands"]),
  commands: z.array(
    z.object({
      command: z.string().min(1),
      passed: z.boolean(),
    }),
  ),
});

const PROpenedSchema = z.object({
  eventType: z.literal("pr_opened"),
  prUrl: z.string().min(1),
  prNumber: z.number().int().positive(),
  draft: z.boolean().optional(),
  wipReason: z.string().optional(),
});

const CICompleteSchema = z.object({
  eventType: z.literal("ci_complete"),
  conclusion: z.enum(["success", "failure", "timeout", "skipped", "cancelled"]),
  localFixRetries: z.number().int().nonnegative().optional(),
  ciFixRetries: z.number().int().nonnegative().optional(),
});

const HaltSchema = z.object({
  eventType: z.literal("halt"),
  stage: z.enum([
    "intake",
    "plan",
    "execute",
    "run-tests",
    "push",
    "open-pr",
    "auto-fix-ci",
  ]),
  reason: z.string().min(1),
});

const EventSchema = z.discriminatedUnion("eventType", [
  ExecuteCompleteSchema,
  TestsCompleteSchema,
  PROpenedSchema,
  CICompleteSchema,
  HaltSchema,
]);

const RecordInputSchema = z.object({
  runId: z.string().min(1),
  repoRoot: z.string().min(1),
  event: EventSchema,
});

const DESCRIPTION =
  "Record a structured event in the per-run summary file at " +
  "<repoRoot>/.tpdc/memory/runs/<runId>.md. Call once per pipeline " +
  "stage as it completes (execute_complete, tests_complete, pr_opened, " +
  "ci_complete) or when the workflow halts (halt). Each call appends one " +
  "markdown section to the file (creates it with a header on the first " +
  "call). The event payload is a discriminated union on `eventType`; the " +
  "MCP tool validates the shape before writing — malformed payloads are " +
  "rejected with a per-field error list and never touch disk. Returns " +
  "{ ok: true, path, created } on success.";

export const recordRunEventTool: ToolDefinition = {
  name: "tpdc_record_run_event",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", description: "Unique run id (matches the runId passed to other tpdc_* tools)." },
      repoRoot: { type: "string", description: "Absolute path to the user's repo root. The summary file lives under <repoRoot>/.tpdc/memory/runs/." },
      event: {
        type: "object",
        description:
          "Discriminated union on `eventType`. One of: " +
          "execute_complete (task, status, branch, filesChanged, finalSummary, toolCallCount, turnCount); " +
          "tests_complete (status, commands[]); " +
          "pr_opened (prUrl, prNumber, draft?, wipReason?); " +
          "ci_complete (conclusion, localFixRetries?, ciFixRetries?); " +
          "halt (stage, reason).",
      },
    },
    required: ["runId", "repoRoot", "event"],
  },
  handler: async (args) => {
    const parsed = RecordInputSchema.safeParse(args);
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

    try {
      const result = await recordRunEvent(parsed.data);
      // Helper-level failure (filesystem error) → isError so the caller
      // sees it. Validation passed but writing failed, e.g., the repoRoot
      // doesn't exist or is read-only.
      if (!result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: true,
        };
      }
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
              { ok: false, error: msg, runId: parsed.data.runId },
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
