import { z } from "zod";
declare const PatchItemSchema: z.ZodObject<{
    stepNumber: z.ZodNumber;
    filePath: z.ZodString;
    operation: z.ZodEnum<{
        create: "create";
        modify: "modify";
        delete: "delete";
    }>;
    diff: z.ZodString;
    justification: z.ZodString;
}, z.core.$strip>;
export declare const PatchArtifactSchema: z.ZodObject<{
    sourceTicket: z.ZodString;
    planTitle: z.ZodString;
    executionMode: z.ZodLiteral<"patch">;
    executionStatus: z.ZodEnum<{
        blocked: "blocked";
        completed: "completed";
        partial: "partial";
        insufficient_context: "insufficient_context";
    }>;
    targetFiles: z.ZodArray<z.ZodString>;
    changeSummary: z.ZodString;
    patches: z.ZodOptional<z.ZodArray<z.ZodObject<{
        stepNumber: z.ZodNumber;
        filePath: z.ZodString;
        operation: z.ZodEnum<{
            create: "create";
            modify: "modify";
            delete: "delete";
        }>;
        diff: z.ZodString;
        justification: z.ZodString;
    }, z.core.$strip>>>;
    assumptions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    risks: z.ZodOptional<z.ZodArray<z.ZodString>>;
    blockedReason: z.ZodOptional<z.ZodString>;
    missingContext: z.ZodOptional<z.ZodArray<z.ZodString>>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type PatchItem = z.infer<typeof PatchItemSchema>;
export type PatchArtifact = z.infer<typeof PatchArtifactSchema>;
export {};
