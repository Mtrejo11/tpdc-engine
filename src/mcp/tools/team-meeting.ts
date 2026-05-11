/**
 * tpdc_team_meeting — heavy MCP tool for the team-of-agents deliberation (D6).
 *
 * Convenes 2-4 role agents (PM, TechLead, Designer, Engineer — subset chosen
 * by the caller) in parallel, then synthesizes their outputs with an Opus
 * moderator. Returns the synthesized answers (with role provenance),
 * assumptions to commit to, preserved dissent, consensus boolean, and
 * (optionally) escalateToHuman if the team couldn't resolve.
 *
 * When to call this:
 *   - The intake skill has bounced on the same set of blocking openQuestions
 *     across N attempts without convergence (the user-Claude-Code dialogue
 *     keeps surfacing the same gaps).
 *   - The user explicitly wants a multi-perspective deliberation on a
 *     contentious decision.
 *   - Plan skill faces a contested architectural call.
 *
 * The team meeting is single-shot: it does NOT recurse. If the result
 * sets `escalateToHuman`, the caller falls back to asking the user.
 *
 * Underlying logic: src/teams/team-meeting.ts (standalone, fully tested).
 * Wrapper validates the input via the same TeamMeetingInputSchema used
 * internally.
 */

import {
  runTeamMeeting,
  type RunTeamMeetingOptions,
} from "../../teams/team-meeting.js";
import { TeamMeetingInputSchema } from "../../teams/schemas.js";
import type { ToolDefinition } from "./types.js";

const DESCRIPTION =
  "Convene a TPDC team-of-agents meeting on the provided open questions. " +
  "Runs 2-4 role agents (PM, TechLead, Designer, Engineer — caller picks " +
  "via rolesToConvene) in parallel, then an Opus moderator synthesizes " +
  "their responses into { answers (with sourceRole), assumptions (to " +
  "commit to), dissent (preserved), consensus, escalateToHuman }. Single- " +
  "shot — does NOT recurse. Cost: ~$0.27-0.31/run. Latency: ~60-75s. Use " +
  "when intake/plan have bounced on the same blocking questions, or for " +
  "explicit multi-perspective deliberation. Required inputs: runId, " +
  "originalRequest, intakeSoFar (validated IntakeArtifact), openQuestions " +
  "(>=1, blocking only), rolesToConvene (>=2 of PM|TechLead|Designer|Engineer).";

export const teamMeetingTool: ToolDefinition = {
  name: "tpdc_team_meeting",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      originalRequest: {
        type: "string",
        description: "Verbatim user request that kicked off the workflow.",
      },
      intakeSoFar: {
        type: "object",
        description: "The most recent (validated) IntakeArtifact for context.",
      },
      openQuestions: {
        type: "array",
        description:
          "The blocking open questions to deliberate on. Each item: " +
          "{ question, owner: 'product'|'engineering'|'design'|'user', blocking: true }. " +
          "Filter intakeSoFar.openQuestions by blocking=true before passing.",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            owner: { type: "string" },
            blocking: { type: "boolean" },
          },
          required: ["question", "owner", "blocking"],
        },
      },
      rolesToConvene: {
        type: "array",
        description:
          "Subset of ['PM', 'TechLead', 'Designer', 'Engineer'] to invite. " +
          "Minimum 2. Designer is usually skipped on non-UI tasks (saves cost). " +
          "Use the shouldIncludeDesigner heuristic if available: include " +
          "Designer when 'card', 'button', 'color', 'layout', 'diseño', etc. " +
          "appear in openQuestions or intakeSoFar.",
        items: {
          type: "string",
          enum: ["PM", "TechLead", "Designer", "Engineer"],
        },
      },
    },
    required: ["runId", "originalRequest", "intakeSoFar", "openQuestions", "rolesToConvene"],
  },
  handler: async (args) => {
    const parsed = TeamMeetingInputSchema.safeParse(args);
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
    const opts: RunTeamMeetingOptions = {
      runId: input.runId,
      originalRequest: input.originalRequest,
      intakeSoFar: input.intakeSoFar,
      openQuestions: input.openQuestions,
      rolesToConvene: input.rolesToConvene,
    };

    try {
      const result = await runTeamMeeting(opts);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        // escalateToHuman != null is a VALID outcome (the team punted to a
        // human). The tool call itself succeeded, so no isError.
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: false, error: msg, stage: "team-meeting", runId: input.runId },
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
