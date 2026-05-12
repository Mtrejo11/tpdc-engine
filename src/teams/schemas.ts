/**
 * Zod schemas for the team-of-agents meeting (D6).
 *
 * One meeting = N role agents (subset of {PM, TechLead, Designer, Engineer})
 * + 1 moderator. Each agent produces a typed structured output; the moderator
 * synthesizes them into the final `TeamMeetingResult`.
 *
 * Schema layers:
 *   - `TeamMeetingInput`   → what `runTeamMeeting()` accepts
 *   - `RoleResponse`       → what each role agent emits (passed to moderator)
 *   - `ModeratorOutput`    → what the moderator agent emits
 *   - `TeamMeetingResult`  → what `runTeamMeeting()` returns (moderator output
 *                            + usage breakdown + runId carryover)
 *
 * See `docs/team-of-agents-spec.md` §5 for the design rationale.
 */

import { z } from "zod";

import {
  IntakeArtifactSchema,
  OpenQuestionSchema,
} from "../stages/intake/intake.schema.js";

// ── Roles ────────────────────────────────────────────────────────────

export const RoleSchema = z.enum(["PM", "TechLead", "Designer", "Engineer"]);
export type Role = z.infer<typeof RoleSchema>;

/** Source attribution for synthesized items. `"synthesis"` = moderator's own
 *  call when no single role dominated. */
export const SourceRoleSchema = z.enum([
  "PM",
  "TechLead",
  "Designer",
  "Engineer",
  "synthesis",
]);

// ── Meeting input ───────────────────────────────────────────────────

export const TeamMeetingInputSchema = z.object({
  runId: z.string().min(1),
  originalRequest: z.string().min(1).describe("Verbatim user request."),
  intakeSoFar: IntakeArtifactSchema.describe(
    "The most recent intake artifact — full context so far.",
  ),
  openQuestions: z
    .array(OpenQuestionSchema)
    .min(1)
    .describe(
      "Blocking questions the meeting must deliberate on. Pulled from " +
        "intakeSoFar.openQuestions where blocking=true.",
    ),
  rolesToConvene: z
    .array(RoleSchema)
    .min(2)
    .describe(
      "Which roles to invite. Caller decides (e.g., resolve-intake omits " +
        "Designer when no UI signal in the openQuestions).",
    ),
});
export type TeamMeetingInput = z.infer<typeof TeamMeetingInputSchema>;

// ── Role response (each role agent's structured output) ─────────────

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export const RoleQuestionAnswerSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe("The open question echoed verbatim, so the moderator can pair answers across roles."),
  applicable: z
    .boolean()
    .describe(
      "Whether this question falls within your role's lens. " +
        "If false, omit `answer` and `confidence` and explain in `notes`.",
    ),
  answer: z
    .string()
    .optional()
    .describe("Your role's answer. Required when applicable=true."),
  confidence: ConfidenceSchema.optional().describe(
    "Your confidence in the answer. Required when applicable=true.",
  ),
  assumptions: z
    .array(z.string())
    .default([])
    .describe(
      "Falsifiable assumptions your answer relies on. State them so they " +
        "can be validated by the executor or overridden by a human reviewer.",
    ),
  notes: z
    .string()
    .optional()
    .describe(
      "Free-form. Use for role-specific extras: risks (TechLead), " +
        "accessibility concerns (Designer), follow-up gaps (Engineer).",
    ),
  requiresHuman: z
    .boolean()
    .default(false)
    .describe(
      "Set true ONLY if this question genuinely cannot be answered without " +
        "external info (e.g., unknowable user preference). Use sparingly — " +
        "the point of the meeting is to commit to assumptions.",
    ),
  requiresHumanReason: z
    .string()
    .optional()
    .describe("Brief reason. Required when requiresHuman=true."),
});
export type RoleQuestionAnswer = z.infer<typeof RoleQuestionAnswerSchema>;

export const RoleResponseSchema = z.object({
  role: RoleSchema.describe("Which role you are. Echo back the role you were asked to play."),
  answers: z
    .array(RoleQuestionAnswerSchema)
    .min(1)
    .describe("One entry per open question, in the same order they were presented."),
});
export type RoleResponse = z.infer<typeof RoleResponseSchema>;

// ── Moderator output (the moderator agent's structured output) ──────

export const SynthesizedAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z
    .string()
    .min(1)
    .describe("The team's collective answer, synthesized from the role responses."),
  sourceRole: SourceRoleSchema.describe(
    "Whose lens dominated this answer. Use 'synthesis' only when no single role drove the call.",
  ),
  confidence: ConfidenceSchema,
});
export type SynthesizedAnswer = z.infer<typeof SynthesizedAnswerSchema>;

export const SynthesizedAssumptionSchema = z.object({
  claim: z
    .string()
    .min(1)
    .describe("Concrete, falsifiable assumption the team is committing to."),
  rationale: z.string().min(1).describe("Why the team made this assumption."),
  falsifiableBy: z
    .string()
    .min(1)
    .describe("How the executor (or a human reviewer) would validate or refute this in code."),
  raisedBy: z
    .array(RoleSchema)
    .min(1)
    .describe("Which role(s) raised or endorsed this assumption."),
});
export type SynthesizedAssumption = z.infer<typeof SynthesizedAssumptionSchema>;

export const DissentSchema = z.object({
  topic: z.string().min(1).describe("What the roles disagreed about."),
  positions: z
    .array(
      z.object({
        role: RoleSchema,
        position: z.string().min(1),
      }),
    )
    .min(2)
    .describe("At least 2 distinct positions held by different roles."),
  resolution: z
    .string()
    .min(1)
    .describe(
      "How the moderator resolved the dissent. Use 'unresolved' " +
        "(literal string) when escalating to a human.",
    ),
});
export type Dissent = z.infer<typeof DissentSchema>;

export const EscalateToHumanSchema = z.object({
  reason: z.string().min(1).describe("Concise reason the team could not commit on its own."),
});
export type EscalateToHuman = z.infer<typeof EscalateToHumanSchema>;

export const ModeratorOutputSchema = z.object({
  answers: z
    .array(SynthesizedAnswerSchema)
    .describe("One synthesized answer per open question."),
  assumptions: z
    .array(SynthesizedAssumptionSchema)
    .default([])
    .describe("Explicit assumptions the team is committing to."),
  dissent: z
    .array(DissentSchema)
    .default([])
    .describe(
      "Preserved disagreements. Do NOT flatten — record so a human can audit. " +
        "If empty array, the team converged with no friction.",
    ),
  consensus: z
    .boolean()
    .describe(
      "True only if ALL convened roles converged with medium+ confidence and " +
        "no dissent. Be suspicious of artificial true — flag groupthink risk in " +
        "the relevant `dissent` entry if you sense it.",
    ),
  escalateToHuman: EscalateToHumanSchema.nullable().describe(
    "Set when the team cannot commit without human input. Otherwise null.",
  ),
});
export type ModeratorOutput = z.infer<typeof ModeratorOutputSchema>;

// ── Final result (what runTeamMeeting returns) ──────────────────────

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /**
   * Thinking-block observation (alpha.14+).
   *
   * `count` is the total of `thinking` + `redacted_thinking` blocks emitted
   * during the call. `hadRedacted` is true iff at least one block was
   * `redacted_thinking` (the platform chose not to expose the reasoning
   * verbatim). Always present on results produced by `runExecutor` on
   * alpha.14+; older persisted results may lack it — hence the
   * `optional()`.
   */
  thinkingBlocks: z
    .object({
      count: z.number().int().nonnegative(),
      hadRedacted: z.boolean(),
    })
    .optional(),
});
export type TeamUsage = z.infer<typeof UsageSchema>;

export const TeamMeetingUsageSchema = z.object({
  PM: UsageSchema.optional(),
  TechLead: UsageSchema.optional(),
  Designer: UsageSchema.optional(),
  Engineer: UsageSchema.optional(),
  moderator: UsageSchema,
});
export type TeamMeetingUsage = z.infer<typeof TeamMeetingUsageSchema>;

/**
 * Final result returned by `runTeamMeeting`. Carries the moderator's output
 * verbatim plus run/usage metadata that the moderator doesn't (and shouldn't)
 * see.
 */
export const TeamMeetingResultSchema = ModeratorOutputSchema.extend({
  runId: z.string().min(1),
  rolesConvened: z.array(RoleSchema).min(1),
  usage: TeamMeetingUsageSchema,
  /** Wall-clock + model audit. */
  moderatorModel: z.string(),
  roleModel: z.string(),
});
export type TeamMeetingResult = z.infer<typeof TeamMeetingResultSchema>;
