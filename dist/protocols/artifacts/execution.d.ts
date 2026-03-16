import { z } from "zod";
declare const StepResultSchema: z.ZodObject<{
    stepNumber: z.ZodNumber;
    title: z.ZodString;
    status: z.ZodEnum<{
        blocked: "blocked";
        completed: "completed";
        partial: "partial";
        skipped: "skipped";
    }>;
    changeSummary: z.ZodString;
    touchedArtifacts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    evidence: z.ZodString;
    blockedReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ExecutionArtifactSchema: z.ZodObject<{
    sourceTicket: z.ZodString;
    planTitle: z.ZodString;
    status: z.ZodEnum<{
        blocked: "blocked";
        completed: "completed";
        partial: "partial";
        failed: "failed";
    }>;
    appliedChangesSummary: z.ZodString;
    touchedArtifacts: z.ZodArray<z.ZodString>;
    evidence: z.ZodArray<z.ZodString>;
    stepResults: z.ZodArray<z.ZodObject<{
        stepNumber: z.ZodNumber;
        title: z.ZodString;
        status: z.ZodEnum<{
            blocked: "blocked";
            completed: "completed";
            partial: "partial";
            skipped: "skipped";
        }>;
        changeSummary: z.ZodString;
        touchedArtifacts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        evidence: z.ZodString;
        blockedReason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type ExecutionArtifact = z.infer<typeof ExecutionArtifactSchema>;
export {};
