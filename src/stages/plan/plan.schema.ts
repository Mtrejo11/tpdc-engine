/**
 * PlanArtifact schema — TPDC v2.
 *
 * The output of the plan stage. Takes an IntakeArtifact (problem framed,
 * AC binary) and produces an executable plan: ordered steps with
 * dependencies, expected files, risk assessment, and a concrete
 * validation approach.
 *
 * Inspired by v1's plan schema (capabilities-v1-archive/installed/decompose/),
 * pruned to v2 essentials and adapted for Zod v4 + structured outputs.
 */

import { z } from "zod";

export const PlanStepSchema = z.object({
  stepNumber: z
    .number()
    .int()
    .min(1)
    .describe("1-indexed sequence number. Steps run in stepNumber order modulo dependencies."),

  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Short imperative description of what this step does."),

  description: z
    .string()
    .min(1)
    .describe(
      "What changes and why. Tied back to the intake's problem statement / AC. " +
        "Describes the change, not how to make it.",
    ),

  acceptanceCriteria: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Binary, testable criteria for THIS step. " +
        "Subset / refinement of the intake's overall AC.",
    ),

  dependencies: z
    .array(z.number().int().min(1))
    .default([])
    .describe(
      "Other stepNumbers that must complete before this step starts. " +
        "Empty means independent / first-batch.",
    ),

  expectedFiles: z
    .array(z.string())
    .default([])
    .describe(
      "Best-effort list of files likely to be created/modified. " +
        "Executor may refine. Empty if unknowable from intake alone.",
    ),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanBlockerSchema = z.object({
  description: z.string().min(1).describe("What is blocking the plan from being executable."),
  resolution: z
    .string()
    .describe("What would unblock it (info needed, decision pending, prerequisite work)."),
});
export type PlanBlocker = z.infer<typeof PlanBlockerSchema>;

export const PlanArtifactSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Short title (≤120 chars) summarizing the plan."),

  objective: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "What the plan accomplishes when fully executed. Should answer the intake's " +
        "problem statement directly.",
    ),

  steps: z
    .array(PlanStepSchema)
    .default([])
    .describe(
      "Ordered list of steps. Empty when readiness != ready (use blockers field).",
    ),

  riskLevel: z
    .enum(["low", "medium", "high"])
    .describe(
      "low: additive change with no behavioral effect on existing code paths. " +
        "medium: modifies existing behavior of a defined area. " +
        "high: changes shared invariants, security, data shape, or system boundaries.",
    ),

  validationApproach: z
    .string()
    .min(1)
    .describe(
      "Concrete way to verify the plan was executed correctly. " +
        "Prefer real test suites or commands. Avoid 'verify it works'. " +
        "Example: 'Run `npm test src/auth/`; smoke-test login flow manually.'",
    ),

  testCommands: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Executable bash commands that validate the plan was correctly applied. " +
        "Run from the repo root in the post-execute worktree. Each command " +
        "must exit 0 for the validation to pass. Examples: " +
        '"npm test src/auth/password-reset/", "pytest tests/billing/", ' +
        '"npm run lint", "tsc --noEmit". ' +
        "Leave empty if no programmatic validation is possible (manual smoke only).",
    ),

  assumptions: z
    .array(z.string())
    .default([])
    .describe(
      "Explicit, falsifiable assumptions inherited from intake or added here. " +
        "If any assumption is wrong, the plan changes.",
    ),

  blockers: z
    .array(PlanBlockerSchema)
    .default([])
    .describe(
      "Reasons the plan is not ready to execute. Empty when readiness=ready.",
    ),

  readiness: z
    .enum(["ready", "needs_input", "not_ready"])
    .describe(
      "ready: steps array is non-empty, all have binary AC, dependencies form a DAG. " +
        "needs_input: plan can be drafted but a blocker requires user input. " +
        "not_ready: intake is too vague to produce a step-level plan.",
    ),
});
export type PlanArtifact = z.infer<typeof PlanArtifactSchema>;
