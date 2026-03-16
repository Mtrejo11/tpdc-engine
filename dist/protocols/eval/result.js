"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvalResultSchema = void 0;
const zod_1 = require("zod");
const ACVerificationSchema = zod_1.z.object({
    ac: zod_1.z.string().min(1),
    verdict: zod_1.z.enum(["pass", "fail", "cannot_verify"]),
    evidence: zod_1.z.string().min(1),
});
const StepVerificationSchema = zod_1.z.object({
    stepNumber: zod_1.z.number().int().positive(),
    title: zod_1.z.string().min(1),
    expectedStatus: zod_1.z.string().min(1),
    actualStatus: zod_1.z.string().min(1),
    statusCorrect: zod_1.z.boolean(),
    evidenceAssessment: zod_1.z.string().min(1),
});
const FindingSchema = zod_1.z.object({
    category: zod_1.z.enum([
        // Suggestion mode
        "missing_evidence", "weak_evidence", "status_mismatch", "ac_gap", "scope_violation", "artifact_gap",
        // Patch mode
        "untargeted_patch", "missing_patch", "invalid_diff",
        // Mutation mode
        "patch_grounding", "apply_integrity", "git_traceability", "workflow_inconsistency",
    ]),
    severity: zod_1.z.enum(["critical", "major", "minor"]),
    description: zod_1.z.string().min(1),
});
const MutationDimensionSchema = zod_1.z.object({
    score: zod_1.z.number().min(0).max(100),
    assessment: zod_1.z.string().min(1),
});
const MutationAssessmentSchema = zod_1.z.object({
    patchGrounding: MutationDimensionSchema,
    applyIntegrity: MutationDimensionSchema,
    gitTraceability: MutationDimensionSchema,
    workflowConsistency: MutationDimensionSchema,
    mutationCorrect: zod_1.z.boolean(),
    mutationSummary: zod_1.z.string().min(1),
});
exports.EvalResultSchema = zod_1.z.object({
    sourceTicket: zod_1.z.string().min(1),
    executionStatus: zod_1.z.string().min(1),
    verdict: zod_1.z.enum(["pass", "fail", "inconclusive"]),
    score: zod_1.z.number().min(0).max(100),
    acVerifications: zod_1.z.array(ACVerificationSchema).min(1),
    stepVerifications: zod_1.z.array(StepVerificationSchema).min(1),
    findings: zod_1.z.array(FindingSchema).optional(),
    mutationAssessment: MutationAssessmentSchema.optional(),
    summary: zod_1.z.string().min(1),
});
//# sourceMappingURL=result.js.map