/**
 * tpdc_open_pr — MCP tool for the open-PR stage.
 *
 * Calls `gh pr create` with title/body rendered from intake + plan + execute
 * + (optional) tests. Returns the PR URL + number. If gh is missing, returns
 * status="gh_missing" with a hint rather than failing the whole pipeline.
 *
 * The nested `intake`, `plan`, `execute`, `tests` objects are validated by
 * the upstream tools (tpdc_validate_intake/plan_artifact, tpdc_execute,
 * tpdc_run_tests). Here we type them through Zod's IntakeArtifactSchema and
 * PlanArtifactSchema for safety; execute and tests pass through as opaque
 * objects (their full Zod schemas live in TS-interface form only — the
 * underlying renderer fails clearly if a required field is missing).
 */

import { z } from "zod";

import { runOpenPR } from "../../stages/open-pr/open-pr.js";
import type { OpenPRRequest } from "../../stages/open-pr/open-pr.schema.js";
import type { ExecuteResult } from "../../stages/execute/execute.schema.js";
import { IntakeArtifactSchema } from "../../stages/intake/intake.schema.js";
import { PlanArtifactSchema } from "../../stages/plan/plan.schema.js";
import type { RunTestsResult } from "../../stages/run-tests/run-tests.schema.js";
import type { ToolDefinition } from "./types.js";

const OpenPRInputSchema = z.object({
  runId: z.string().min(1),
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
  intake: IntakeArtifactSchema,
  plan: PlanArtifactSchema,
  // execute and tests pass through as unknown — already validated upstream
  execute: z.unknown(),
  tests: z.unknown().optional(),
  draft: z.boolean().optional(),
  wipReason: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).optional(),
});

const DESCRIPTION =
  "Run the TPDC open-PR stage: `gh pr create` with title/body rendered from " +
  "intake + plan + execute + (optional) tests. Returns { status: opened | " +
  "gh_missing | failed | errored, prUrl, prNumber, title, body, stdout, " +
  "stderr, exitCode, durationMs }. Pass intake/plan as the validated " +
  "artifacts from upstream tools; execute as the result of tpdc_execute; " +
  "tests as the result of tpdc_run_tests (omit on WIP paths). draft=true " +
  "opens as a draft PR. wipReason adds a WIP warning at the top of the body.";

export const openPRTool: ToolDefinition = {
  name: "tpdc_open_pr",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      repoRoot: { type: "string", description: "Absolute path to the user's repo (used as cwd for gh)." },
      branch: { type: "string", description: "Branch name that was pushed (head ref of the PR)." },
      baseBranch: { type: "string", description: "Base branch the PR targets. Default 'main'." },
      intake: { type: "object", description: "Validated IntakeArtifact." },
      plan: { type: "object", description: "Validated PlanArtifact." },
      execute: { type: "object", description: "Result of tpdc_execute." },
      tests: { type: "object", description: "Optional result of tpdc_run_tests. Omit on WIP halts." },
      draft: { type: "boolean", description: "Open as draft PR. Default false." },
      wipReason: { type: "string", description: "If set, adds a WIP warning at the top of the body." },
      timeoutMs: { type: "number", description: "Timeout in ms. Default 60000." },
    },
    required: ["runId", "repoRoot", "branch", "intake", "plan", "execute"],
  },
  handler: async (args) => {
    const parsed = OpenPRInputSchema.safeParse(args);
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
    const req: OpenPRRequest = {
      runId: input.runId,
      repoRoot: input.repoRoot,
      branch: input.branch,
      ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
      intake: input.intake,
      plan: input.plan,
      execute: input.execute as ExecuteResult,
      ...(input.tests !== undefined ? { tests: input.tests as RunTestsResult } : {}),
      ...(input.draft !== undefined ? { draft: input.draft } : {}),
      ...(input.wipReason !== undefined ? { wipReason: input.wipReason } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    };

    try {
      const result = await runOpenPR(req);
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
              { ok: false, error: msg, stage: "open-pr", runId: input.runId },
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
