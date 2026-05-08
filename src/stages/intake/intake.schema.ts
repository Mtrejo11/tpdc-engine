/**
 * IntakeArtifact schema — TPDC v2.
 *
 * The output of the intake stage. Converts a vague request into a
 * structured ticket: problem statement, acceptance criteria, scope,
 * open questions. Solution-language gets stripped so downstream stages
 * (plan, execute) reason about *what* needs to change without prejudging *how*.
 *
 * Inspired by v1's intake schema (capabilities-v1-archive/installed/intake/),
 * pruned to essentials and adapted for Zod v4 + structured outputs.
 */

import { z } from "zod";

export const OpenQuestionSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe("Specific question that must be answered before execution."),
  owner: z
    .enum(["product", "engineering", "design", "user"])
    .describe("Who is best positioned to answer this question."),
  blocking: z
    .boolean()
    .describe(
      "If true, this question blocks the workflow until answered. " +
        "If false, the workflow can proceed but the answer would improve quality.",
    ),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const IntakeArtifactSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Short title (≤120 chars) summarizing the request."),

  problemStatement: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "What hurts and for whom. NO solution language (no 'add', 'build', 'implement'). " +
        "Frame as a user-facing problem.",
    ),

  affectedUsers: z
    .string()
    .min(1)
    .max(255)
    .describe("Who experiences this problem (role / segment / specific people)."),

  observableSymptom: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Concrete, observable behavior that demonstrates the problem. " +
        "What does someone see/measure that confirms it?",
    ),

  acceptanceCriteria: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Binary, testable criteria. Each must be answerable yes/no after execution. " +
        "No subjective criteria.",
    ),

  outOfScope: z
    .array(z.string())
    .default([])
    .describe(
      "Adjacent things NOT being changed in this workflow, to prevent scope creep.",
    ),

  assumptions: z
    .array(z.string())
    .default([])
    .describe(
      "Explicit, falsifiable assumptions made about the problem space. " +
        "If any assumption is wrong, the plan changes.",
    ),

  openQuestions: z
    .array(OpenQuestionSchema)
    .default([])
    .describe("Questions that need answers before or during execution."),

  readiness: z
    .enum(["ready", "needs_input", "not_ready"])
    .describe(
      "ready: enough info to plan execution. " +
        "needs_input: missing context (open questions are blocking). " +
        "not_ready: request is too vague to produce binary acceptance criteria.",
    ),
});
export type IntakeArtifact = z.infer<typeof IntakeArtifactSchema>;
