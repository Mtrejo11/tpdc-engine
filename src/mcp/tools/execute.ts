/**
 * tpdc_execute — heavy MCP tool for the execute stage.
 *
 * Pattern shift from the validators (intake/plan): this is an autonomous
 * operation, not a Zod parse. Input arrives → worktree is created (or
 * reused for fix-mode) → an agentic tool-use loop with bash + text_editor
 * runs against the worktree → diff is captured and committed → result is
 * returned. The caller (Claude Code via a top-level skill, or the
 * forthcoming auto-fix-CI tool) invokes this and waits.
 *
 * Inputs are validated with Zod before delegating to runExecute. This
 * protects against malformed plans / missing required fields surfacing as
 * cryptic errors deep in the agent loop.
 *
 * See VISION.md §3 (execute is an MCP tool, not a skill) and
 * src/stages/execute/execute.ts for the underlying engine.
 */

import { z } from "zod";

import { runExecute } from "../../stages/execute/execute.js";
import type { ExecuteRequest } from "../../stages/execute/execute.schema.js";
import { PlanArtifactSchema } from "../../stages/plan/plan.schema.js";
import type { ToolDefinition } from "./types.js";

// ── Input validation ────────────────────────────────────────────────

const ExistingWorktreeSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  baseSha: z.string().min(1),
});

const FailureContextSchema = z.object({
  attempt: z.number().int().min(1),
  previousCommands: z.array(
    z.object({
      command: z.string().min(1),
      exitCode: z.number().int(),
      stdout: z.string(),
      stderr: z.string(),
    }),
  ),
  previousFinalSummary: z.string().optional(),
});

const ExecuteInputSchema = z.object({
  runId: z.string().min(1),
  intakeTitle: z.string().min(1),
  plan: PlanArtifactSchema,
  repoRoot: z.string().min(1),
  maxTurns: z.number().int().min(1).max(200).optional(),
  commitMessage: z.string().optional(),
  existingWorktree: ExistingWorktreeSchema.optional(),
  failureContext: FailureContextSchema.optional(),
});

// ── Tool definition ─────────────────────────────────────────────────

const DESCRIPTION =
  "Run the TPDC execute stage: spin up a git worktree under " +
  "<repoRoot>/.tpdc/worktrees/<runId>/, run an agentic bash + text_editor " +
  "loop against the plan, capture the diff, and commit. Returns the " +
  "ExecuteResult JSON (status, worktreePath, branch, baseSha, commitSha, " +
  "filesChanged, diff, finalSummary, toolCallCount, turnCount, usage). " +
  "Use this AFTER the plan has been validated. For fix-mode (after a test " +
  "or CI failure), pass `failureContext` + `existingWorktree` to reuse the " +
  "same branch. Required inputs: runId, intakeTitle, plan, repoRoot.";

export const executeTool: ToolDefinition = {
  name: "tpdc_execute",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: {
        type: "string",
        description: "Unique identifier for this TPDC run. Used as the worktree directory name and branch suffix.",
      },
      intakeTitle: {
        type: "string",
        description: "Short title from the IntakeArtifact. Used as the commit message subject.",
      },
      plan: {
        type: "object",
        description:
          "Validated PlanArtifact (use tpdc_validate_plan_artifact first). " +
          "Drives the agent's work. See src/stages/plan/plan.schema.ts.",
      },
      repoRoot: {
        type: "string",
        description: "Absolute path to the target repository. Must be a git repo.",
      },
      maxTurns: {
        type: "number",
        description: "Cap on agent loop turns. Default 60. Range [1, 200].",
      },
      commitMessage: {
        type: "string",
        description: "Override commit message. If omitted, derived from intakeTitle + runId.",
      },
      existingWorktree: {
        type: "object",
        description:
          "Reuse a worktree from a prior call (for fix-mode). Must include path, branch, baseSha returned by an earlier tpdc_execute call.",
        properties: {
          path: { type: "string" },
          branch: { type: "string" },
          baseSha: { type: "string" },
        },
        required: ["path", "branch", "baseSha"],
      },
      failureContext: {
        type: "object",
        description:
          "When set, the executor enters fix-mode: the system prompt is augmented to focus on the minimum fix for the previous failure, and the user input includes the failing commands' stdout/stderr.",
        properties: {
          attempt: {
            type: "number",
            description: "1-indexed retry attempt number.",
          },
          previousCommands: {
            type: "array",
            description: "The commands that failed in the previous attempt.",
            items: {
              type: "object",
              properties: {
                command: { type: "string" },
                exitCode: { type: "number" },
                stdout: { type: "string" },
                stderr: { type: "string" },
              },
              required: ["command", "exitCode", "stdout", "stderr"],
            },
          },
          previousFinalSummary: {
            type: "string",
            description: "Final summary from the previous execute (if any).",
          },
        },
        required: ["attempt", "previousCommands"],
      },
    },
    required: ["runId", "intakeTitle", "plan", "repoRoot"],
  },
  handler: async (args) => {
    const parsed = ExecuteInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                errors: parsed.error.issues.map((i) => ({
                  path: i.path
                    .map((s) => (typeof s === "number" ? String(s) : s))
                    .join("."),
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
    const request: ExecuteRequest = {
      runId: input.runId,
      intakeTitle: input.intakeTitle,
      plan: input.plan,
      repoRoot: input.repoRoot,
      ...(input.maxTurns !== undefined ? { maxTurns: input.maxTurns } : {}),
      ...(input.commitMessage !== undefined
        ? { commitMessage: input.commitMessage }
        : {}),
      ...(input.existingWorktree !== undefined
        ? { existingWorktree: input.existingWorktree }
        : {}),
      ...(input.failureContext !== undefined
        ? { failureContext: input.failureContext }
        : {}),
    };

    try {
      const result = await runExecute(request);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        // We return the ExecuteResult verbatim. The status field (e.g.,
        // "max_turns_exceeded", "tool_error_loop", "model_refused") tells
        // the caller whether the run was successful — the tool call itself
        // succeeded (no isError) as long as we got a result.
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: msg,
                stage: "execute",
                runId: input.runId,
              },
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
