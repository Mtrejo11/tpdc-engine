import { z } from "zod";

const ACVerificationSchema = z.object({
  ac: z.string().min(1),
  verdict: z.enum(["pass", "fail", "cannot_verify"]),
  evidence: z.string().min(1),
});

const StepVerificationSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().min(1),
  expectedStatus: z.string().min(1),
  actualStatus: z.string().min(1),
  statusCorrect: z.boolean(),
  evidenceAssessment: z.string().min(1),
});

const FindingSchema = z.object({
  category: z.enum([
    // Suggestion mode
    "missing_evidence", "weak_evidence", "status_mismatch", "ac_gap", "scope_violation", "artifact_gap",
    // Patch mode
    "untargeted_patch", "missing_patch", "invalid_diff",
    // Mutation mode
    "patch_grounding", "apply_integrity", "git_traceability", "workflow_inconsistency",
  ]),
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string().min(1),
});

const MutationDimensionSchema = z.object({
  score: z.number().min(0).max(100),
  assessment: z.string().min(1),
});

const MutationAssessmentSchema = z.object({
  patchGrounding: MutationDimensionSchema,
  applyIntegrity: MutationDimensionSchema,
  gitTraceability: MutationDimensionSchema,
  workflowConsistency: MutationDimensionSchema,
  mutationCorrect: z.boolean(),
  mutationSummary: z.string().min(1),
});

export const EvalResultSchema = z.object({
  sourceTicket: z.string().min(1),
  executionStatus: z.string().min(1),
  verdict: z.enum(["pass", "fail", "inconclusive"]),
  score: z.number().min(0).max(100),
  acVerifications: z.array(ACVerificationSchema).min(1),
  stepVerifications: z.array(StepVerificationSchema).min(1),
  findings: z.array(FindingSchema).optional(),
  mutationAssessment: MutationAssessmentSchema.optional(),
  summary: z.string().min(1),
});

export type ACVerification = z.infer<typeof ACVerificationSchema>;
export type StepVerification = z.infer<typeof StepVerificationSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type MutationDimension = z.infer<typeof MutationDimensionSchema>;
export type MutationAssessment = z.infer<typeof MutationAssessmentSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
