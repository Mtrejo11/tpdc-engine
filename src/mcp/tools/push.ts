/**
 * tpdc_push — MCP tool for the push stage.
 *
 * Pushes the worktree branch to the remote via `git push -u`. On success,
 * removes the worktree directory (the branch ref stays local for auto-fix-CI
 * re-creation). Auth is delegated to the user's git credentials.
 */

import { z } from "zod";

import { runPush } from "../../stages/push/push.js";
import type { PushRequest } from "../../stages/push/push.schema.js";
import type { ToolDefinition } from "./types.js";

const PushInputSchema = z.object({
  runId: z.string().min(1),
  repoRoot: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  remote: z.string().min(1).optional(),
  force: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
});

const DESCRIPTION =
  "Run the TPDC push stage: `git push -u <remote> <branch>` from the worktree. " +
  "On success, removes the worktree directory (the local branch ref is kept " +
  "for auto-fix-CI re-creation). Returns { status: pushed | failed | errored, " +
  "branch, remote, stdout, stderr, exitCode, worktreeRemoved, durationMs }. " +
  "Set force=true for force-push-with-lease (used in auto-fix-CI). Auth uses " +
  "the user's existing git credentials.";

export const pushTool: ToolDefinition = {
  name: "tpdc_push",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      repoRoot: { type: "string", description: "Absolute path to the user's repo (parent of the worktree)." },
      worktreePath: { type: "string", description: "Absolute path to the worktree being pushed." },
      branch: { type: "string", description: "Branch name to push." },
      remote: { type: "string", description: "Remote name. Default 'origin'." },
      force: { type: "boolean", description: "Force push with --force-with-lease. Default false." },
      timeoutMs: { type: "number", description: "Timeout in ms. Default 60000 (60s). Range [1000, 600000]." },
    },
    required: ["runId", "repoRoot", "worktreePath", "branch"],
  },
  handler: async (args) => {
    const parsed = PushInputSchema.safeParse(args);
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
    const req: PushRequest = {
      runId: input.runId,
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      branch: input.branch,
      ...(input.remote !== undefined ? { remote: input.remote } : {}),
      ...(input.force !== undefined ? { force: input.force } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    };

    try {
      const result = await runPush(req);
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
              { ok: false, error: msg, stage: "push", runId: input.runId },
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
