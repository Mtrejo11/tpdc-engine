/**
 * tpdc_validate_plan_artifact — Zod + semantic validator for PlanArtifact.
 *
 * Claude Code (running the plan skill) builds a candidate `PlanArtifact`
 * from an IntakeArtifact + repo exploration and calls this MCP tool to
 * check shape AND semantic invariants (DAG, dependency refs, readiness/steps
 * consistency). On failure, the agent fixes specific fields based on error
 * paths/codes and retries.
 *
 * Thin wrapper over `validatePlanArtifact` from `src/stages/plan/validate.ts`.
 */

import { validatePlanArtifact } from "../../stages/plan/validate.js";
import type { ToolDefinition } from "./types.js";

const DESCRIPTION =
  "Validate a candidate PlanArtifact against the TPDC plan schema AND " +
  "semantic invariants (DAG of step dependencies, no unknown dependency refs, " +
  "no self-loops, readiness consistent with steps/blockers). Pass the artifact " +
  "object; the tool returns either { ok: true, artifact } (with schema defaults " +
  "applied) or { ok: false, errors: [{ path, message, code }] }. Error codes for " +
  "semantic checks include: empty_steps_when_ready, missing_blockers, " +
  "duplicate_step_number, self_dependency, unknown_dependency, dependency_cycle.";

export const validatePlanArtifactTool: ToolDefinition = {
  name: "tpdc_validate_plan_artifact",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      artifact: {
        type: "object",
        description:
          "The candidate PlanArtifact to validate. Required fields: title, " +
          "objective, riskLevel ('low'|'medium'|'high'), validationApproach, " +
          "readiness ('ready'|'needs_input'|'not_ready'). Steps array required " +
          "when readiness='ready'; each step has stepNumber (unique, int>=1), " +
          "title, description, acceptanceCriteria (>=1), dependencies (DAG of " +
          "existing stepNumbers), expectedFiles. See full schema in " +
          "src/stages/plan/plan.schema.ts.",
      },
    },
    required: ["artifact"],
  },
  handler: async (args) => {
    const artifact = args["artifact"];
    if (artifact === undefined) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                errors: [
                  {
                    path: "",
                    message: "Missing required argument: 'artifact'",
                    code: "missing_argument",
                  },
                ],
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    const result = validatePlanArtifact(artifact);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};
