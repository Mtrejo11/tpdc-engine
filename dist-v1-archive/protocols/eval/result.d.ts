import { z } from "zod";
declare const ACVerificationSchema: z.ZodObject<{
    ac: z.ZodString;
    verdict: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        cannot_verify: "cannot_verify";
    }>;
    evidence: z.ZodString;
}, z.core.$strip>;
declare const StepVerificationSchema: z.ZodObject<{
    stepNumber: z.ZodNumber;
    title: z.ZodString;
    expectedStatus: z.ZodString;
    actualStatus: z.ZodString;
    statusCorrect: z.ZodBoolean;
    evidenceAssessment: z.ZodString;
}, z.core.$strip>;
declare const FindingSchema: z.ZodObject<{
    category: z.ZodEnum<{
        missing_evidence: "missing_evidence";
        weak_evidence: "weak_evidence";
        status_mismatch: "status_mismatch";
        ac_gap: "ac_gap";
        scope_violation: "scope_violation";
        artifact_gap: "artifact_gap";
        untargeted_patch: "untargeted_patch";
        missing_patch: "missing_patch";
        invalid_diff: "invalid_diff";
        patch_grounding: "patch_grounding";
        apply_integrity: "apply_integrity";
        git_traceability: "git_traceability";
        workflow_inconsistency: "workflow_inconsistency";
    }>;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
    }>;
    description: z.ZodString;
}, z.core.$strip>;
declare const MutationDimensionSchema: z.ZodObject<{
    score: z.ZodNumber;
    assessment: z.ZodString;
}, z.core.$strip>;
declare const MutationAssessmentSchema: z.ZodObject<{
    patchGrounding: z.ZodObject<{
        score: z.ZodNumber;
        assessment: z.ZodString;
    }, z.core.$strip>;
    applyIntegrity: z.ZodObject<{
        score: z.ZodNumber;
        assessment: z.ZodString;
    }, z.core.$strip>;
    gitTraceability: z.ZodObject<{
        score: z.ZodNumber;
        assessment: z.ZodString;
    }, z.core.$strip>;
    workflowConsistency: z.ZodObject<{
        score: z.ZodNumber;
        assessment: z.ZodString;
    }, z.core.$strip>;
    mutationCorrect: z.ZodBoolean;
    mutationSummary: z.ZodString;
}, z.core.$strip>;
export declare const EvalResultSchema: z.ZodObject<{
    sourceTicket: z.ZodString;
    executionStatus: z.ZodString;
    verdict: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        inconclusive: "inconclusive";
    }>;
    score: z.ZodNumber;
    acVerifications: z.ZodArray<z.ZodObject<{
        ac: z.ZodString;
        verdict: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
            cannot_verify: "cannot_verify";
        }>;
        evidence: z.ZodString;
    }, z.core.$strip>>;
    stepVerifications: z.ZodArray<z.ZodObject<{
        stepNumber: z.ZodNumber;
        title: z.ZodString;
        expectedStatus: z.ZodString;
        actualStatus: z.ZodString;
        statusCorrect: z.ZodBoolean;
        evidenceAssessment: z.ZodString;
    }, z.core.$strip>>;
    findings: z.ZodOptional<z.ZodArray<z.ZodObject<{
        category: z.ZodEnum<{
            missing_evidence: "missing_evidence";
            weak_evidence: "weak_evidence";
            status_mismatch: "status_mismatch";
            ac_gap: "ac_gap";
            scope_violation: "scope_violation";
            artifact_gap: "artifact_gap";
            untargeted_patch: "untargeted_patch";
            missing_patch: "missing_patch";
            invalid_diff: "invalid_diff";
            patch_grounding: "patch_grounding";
            apply_integrity: "apply_integrity";
            git_traceability: "git_traceability";
            workflow_inconsistency: "workflow_inconsistency";
        }>;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
        }>;
        description: z.ZodString;
    }, z.core.$strip>>>;
    mutationAssessment: z.ZodOptional<z.ZodObject<{
        patchGrounding: z.ZodObject<{
            score: z.ZodNumber;
            assessment: z.ZodString;
        }, z.core.$strip>;
        applyIntegrity: z.ZodObject<{
            score: z.ZodNumber;
            assessment: z.ZodString;
        }, z.core.$strip>;
        gitTraceability: z.ZodObject<{
            score: z.ZodNumber;
            assessment: z.ZodString;
        }, z.core.$strip>;
        workflowConsistency: z.ZodObject<{
            score: z.ZodNumber;
            assessment: z.ZodString;
        }, z.core.$strip>;
        mutationCorrect: z.ZodBoolean;
        mutationSummary: z.ZodString;
    }, z.core.$strip>>;
    summary: z.ZodString;
}, z.core.$strip>;
export type ACVerification = z.infer<typeof ACVerificationSchema>;
export type StepVerification = z.infer<typeof StepVerificationSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type MutationDimension = z.infer<typeof MutationDimensionSchema>;
export type MutationAssessment = z.infer<typeof MutationAssessmentSchema>;
export type EvalResult = z.infer<typeof EvalResultSchema>;
export {};
