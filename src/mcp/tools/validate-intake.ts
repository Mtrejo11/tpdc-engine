/**
 * tpdc_validate_intake_artifact — Zod validator for IntakeArtifact.
 *
 * Claude Code (running the intake skill) builds a candidate `IntakeArtifact`
 * by exploring the repo with its native Read/Grep/Glob tools and asking the
 * user about genuinely human-only decisions. It calls this MCP tool to
 * check shape. On failure, the agent fixes specific fields based on the
 * error paths and retries.
 *
 * This is intentionally a thin wrapper around `validateIntakeArtifact` from
 * `src/stages/intake/validate.ts` — the MCP layer just adapts the pure
 * function to the tool call/response format.
 */

import { validateIntakeArtifact } from "../../stages/intake/validate.js";
import type { ToolDefinition } from "./types.js";

const DESCRIPTION =
  "Validate a candidate IntakeArtifact against the TPDC intake schema. " +
  "Pass the artifact object; the tool returns either { ok: true, artifact } " +
  "(with schema defaults applied) or { ok: false, errors: [{ path, message, code }] }. " +
  "Use this after producing an intake candidate to verify shape before passing " +
  "to downstream stages. On failure, the `path` field pinpoints exactly which " +
  "field needs fixing.";

export const validateIntakeArtifactTool: ToolDefinition = {
  name: "tpdc_validate_intake_artifact",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      artifact: {
        type: "object",
        description:
          "The candidate IntakeArtifact to validate. Must include at least: " +
          "title, problemStatement, affectedUsers, observableSymptom, " +
          "acceptanceCriteria (non-empty array), readiness (one of " +
          "'ready' | 'needs_input' | 'not_ready'). Optional arrays " +
          "(outOfScope, assumptions, openQuestions) default to []. " +
          "See full schema in src/stages/intake/intake.schema.ts.",
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

    const result = validateIntakeArtifact(artifact);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      // We deliberately do NOT set isError on validation failure — the tool
      // call itself succeeded; the result just reports invalidity. Claude
      // Code reads `ok: false` from the JSON and retries on its own.
    };
  },
};
