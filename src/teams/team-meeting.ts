/**
 * Team meeting helper (D6).
 *
 * Orchestrates the team-of-agents deliberation:
 *   1. Invoke the chosen role agents in parallel (each is a single
 *      structured-output `runExecutor` call).
 *   2. Pass all role responses to the moderator (Opus 4.6 by default) for
 *      synthesis.
 *   3. Return the moderator's output + per-role usage breakdown.
 *
 * Standalone — no Inngest dependency. The caller (resolve-intake.ts)
 * decides WHEN to call this; this module decides only HOW to run the
 * meeting once invoked.
 *
 * Errors propagate. If any role agent fails, the whole meeting fails;
 * the caller should catch and fall back to the human-wait path (see
 * spec §9 escalation table).
 *
 * See `docs/team-of-agents-spec.md` §2 + §7 for the architectural context.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  DEFAULT_ADVISOR_MODEL,
  DEFAULT_EXECUTOR_MODEL,
  runExecutor,
} from "../runtime/executor.js";
import {
  DESIGNER_KEYWORD_HINTS,
  DESIGNER_SYSTEM_PROMPT,
  ENGINEER_SYSTEM_PROMPT,
  MODERATOR_SYSTEM_PROMPT,
  PM_SYSTEM_PROMPT,
  TECH_LEAD_SYSTEM_PROMPT,
} from "./role-prompts.js";
import {
  ModeratorOutputSchema,
  RoleResponseSchema,
  type Role,
  type RoleResponse,
  type TeamMeetingInput,
  type TeamMeetingResult,
  type TeamMeetingUsage,
  type TeamUsage,
} from "./schemas.js";

// ── Public API ──────────────────────────────────────────────────────

/**
 * Default “thinking budget” knob for the moderator (v0.4.0-alpha.12+).
 *
 * The Anthropic API no longer accepts `thinking.type: "enabled"` on Opus
 * 4.7; it expects `thinking.type: "adaptive"` with `output_config.effort`.
 * We keep this numeric knob as a **proxy**: it maps to `effort` (and
 * still scales `max_tokens` for headroom on large moderator JSON).
 *
 * Role agents stay no-thinking — each role is one opinionated response,
 * and we run 2-4 in parallel where extra reasoning would multiply cost.
 *
 * Set `moderatorThinkingBudget: 0` to disable.
 */
const DEFAULT_MODERATOR_THINKING_BUDGET = 2048;

/** Maps the legacy budget dial to the platform's `output_config.effort`. */
function moderatorBudgetToOutputEffort(
  budget: number,
): "low" | "medium" | "high" | "max" {
  if (budget >= 6144) return "max";
  if (budget >= 2048) return "high";
  return "medium";
}

/**
 * Moderator `max_tokens` floor when adaptive thinking is on — generous
 * ceiling for structured moderator JSON, independent of effort mapping.
 */
const MODERATOR_THINKING_MAX_TOKENS_FLOOR = 4096;

export interface RunTeamMeetingOptions extends TeamMeetingInput {
  /** Override Anthropic client (tests). */
  client?: Anthropic;
  /** Model for role agents. Defaults to Sonnet 4.6. */
  roleModel?: string;
  /** Model for the moderator. Defaults to Opus 4.6 (D6). */
  moderatorModel?: string;
  /**
   * Thinking intensity dial for the moderator (alpha.12+).
   *
   * - `undefined` (default) → `DEFAULT_MODERATOR_THINKING_BUDGET` (maps to
   *   adaptive thinking + `output_config.effort` via
   *   `moderatorBudgetToOutputEffort`).
   * - `0` → no extended thinking on the moderator call.
   * - any value `> 0` → adaptive thinking on; larger values map to higher
   *   `effort` (`medium` / `high` / `max`). `max_tokens` is bumped for
   *   output headroom.
   */
  moderatorThinkingBudget?: number;
}

/**
 * Run a team meeting end-to-end.
 *
 * Cost (default models, typical sizes): ~$0.27–0.31 per meeting.
 * Latency: roles run in parallel (~30-45s), moderator after (~20-30s).
 */
export async function runTeamMeeting(
  opts: RunTeamMeetingOptions,
): Promise<TeamMeetingResult> {
  const client = opts.client;
  const roleModel = opts.roleModel ?? DEFAULT_EXECUTOR_MODEL;
  const moderatorModel = opts.moderatorModel ?? DEFAULT_ADVISOR_MODEL;

  if (opts.rolesToConvene.length < 2) {
    throw new Error(
      `team-meeting: at least 2 roles must be convened (got ${opts.rolesToConvene.length})`,
    );
  }
  if (opts.openQuestions.length === 0) {
    throw new Error("team-meeting: openQuestions must not be empty");
  }

  const roleUserInput = buildRoleUserInput(opts);

  // 1. Parallel role agents
  const rolePromises = opts.rolesToConvene.map(async (role) => {
    const result = await runExecutor({
      systemPrompt: ROLE_PROMPTS[role],
      userInput: roleUserInput,
      outputSchema: RoleResponseSchema,
      model: roleModel,
      client,
    });
    // The model occasionally emits a different role label than asked; we
    // overwrite to match what we asked for, since we're the source of truth.
    const response: RoleResponse = { ...result.output, role };
    return { role, response, usage: result.usage };
  });

  const roleResults = await Promise.all(rolePromises);

  // 2. Moderator synthesis (alpha.12: extended thinking by default).
  const moderatorUserInput = buildModeratorUserInput(
    opts,
    roleResults.map((r) => r.response),
  );
  const moderatorThinkingBudget =
    opts.moderatorThinkingBudget ?? DEFAULT_MODERATOR_THINKING_BUDGET;
  const moderatorMaxTokens =
    moderatorThinkingBudget > 0
      ? Math.max(MODERATOR_THINKING_MAX_TOKENS_FLOOR, moderatorThinkingBudget * 2)
      : undefined;
  const moderatorResult = await runExecutor({
    systemPrompt: MODERATOR_SYSTEM_PROMPT,
    userInput: moderatorUserInput,
    outputSchema: ModeratorOutputSchema,
    model: moderatorModel,
    client,
    ...(moderatorMaxTokens !== undefined ? { maxTokens: moderatorMaxTokens } : {}),
    ...(moderatorThinkingBudget > 0
      ? {
          thinking: { type: "adaptive" as const },
          thinkingOutputEffort: moderatorBudgetToOutputEffort(moderatorThinkingBudget),
        }
      : {}),
  });

  // 3. Build the final result
  const usage: TeamMeetingUsage = { moderator: moderatorResult.usage };
  for (const { role, usage: u } of roleResults) {
    usage[role] = u;
  }

  return {
    runId: opts.runId,
    rolesConvened: opts.rolesToConvene,
    usage,
    roleModel,
    moderatorModel: moderatorResult.model,
    ...moderatorResult.output,
  };
}

// ── Designer auto-skip heuristic ────────────────────────────────────

/**
 * Decide whether to invite the Designer based on signals in the open
 * questions and the intake context.
 *
 * Rationale: Designer adds ~$0.04 per meeting and slows synthesis with
 * noise on tasks that have no UI dimension. Auto-skip when no keyword
 * from `DESIGNER_KEYWORD_HINTS` appears.
 *
 * The caller (resolve-intake) is responsible for using this to compute
 * `rolesToConvene` before calling `runTeamMeeting`.
 */
export function shouldIncludeDesigner(
  openQuestions: ReadonlyArray<{ question: string }>,
  intakeSoFar: {
    affectedUsers: string;
    observableSymptom: string;
    problemStatement: string;
  },
): boolean {
  const haystack = [
    ...openQuestions.map((q) => q.question),
    intakeSoFar.affectedUsers,
    intakeSoFar.observableSymptom,
    intakeSoFar.problemStatement,
  ]
    .join(" ")
    .toLowerCase();

  return DESIGNER_KEYWORD_HINTS.some((kw) =>
    haystack.includes(kw.toLowerCase()),
  );
}

// ── Internal helpers ────────────────────────────────────────────────

const ROLE_PROMPTS: Record<Role, string> = {
  PM: PM_SYSTEM_PROMPT,
  TechLead: TECH_LEAD_SYSTEM_PROMPT,
  Designer: DESIGNER_SYSTEM_PROMPT,
  Engineer: ENGINEER_SYSTEM_PROMPT,
};

function buildRoleUserInput(input: TeamMeetingInput): string {
  const lines: string[] = [
    `# Run: ${input.runId}`,
    ``,
    `## Original user request`,
    input.originalRequest.trim(),
    ``,
    `## Intake context gathered so far`,
    "```json",
    JSON.stringify(input.intakeSoFar, null, 2),
    "```",
    ``,
    `## Open questions blocking the intake stage`,
    ``,
  ];
  input.openQuestions.forEach((q, i) => {
    lines.push(`${i + 1}. **${q.question}**  *(owner suggested: ${q.owner})*`);
  });
  lines.push(
    ``,
    `Answer each question from YOUR role's lens. Be opinionated and commit.`,
    `Echo the question verbatim in each answer entry for cross-role alignment.`,
  );
  return lines.join("\n");
}

function buildModeratorUserInput(
  input: TeamMeetingInput,
  responses: ReadonlyArray<RoleResponse>,
): string {
  const lines: string[] = [
    `# Team meeting synthesis — run ${input.runId}`,
    ``,
    `## Original user request`,
    input.originalRequest.trim(),
    ``,
    `## Intake context (so the role responses make sense in context)`,
    "```json",
    JSON.stringify(input.intakeSoFar, null, 2),
    "```",
    ``,
    `## Open questions that were deliberated`,
    ``,
  ];
  input.openQuestions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}`);
  });
  lines.push(``, `## Role responses`, ``);
  for (const r of responses) {
    lines.push(`### ${r.role} response`);
    lines.push("```json");
    lines.push(JSON.stringify(r, null, 2));
    lines.push("```");
    lines.push(``);
  }
  lines.push(
    `Synthesize the team's collective answer per the ModeratorOutput schema. `,
    `Preserve dissent. Mark consensus only if genuine. If you cannot commit, `,
    `set escalateToHuman with a concise reason.`,
  );
  return lines.join("\n");
}

// Re-export for tests / consumers that don't want to import from schemas.ts
export type { Role, RoleResponse, TeamMeetingInput, TeamMeetingResult, TeamUsage };
