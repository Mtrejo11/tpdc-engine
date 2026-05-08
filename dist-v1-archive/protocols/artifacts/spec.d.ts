import { z } from "zod";
export declare const SpecArtifactSchema: z.ZodObject<{
    title: z.ZodString;
    status: z.ZodEnum<{
        proposed: "proposed";
        accepted: "accepted";
        superseded: "superseded";
        deprecated: "deprecated";
    }>;
    date: z.ZodString;
    sourceTicket: z.ZodString;
    context: z.ZodArray<z.ZodString>;
    decision: z.ZodString;
    scope: z.ZodObject<{
        inScope: z.ZodArray<z.ZodString>;
        outOfScope: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    validationPlan: z.ZodArray<z.ZodObject<{
        ac: z.ZodString;
        verification: z.ZodString;
    }, z.core.$strip>>;
    risks: z.ZodArray<z.ZodObject<{
        risk: z.ZodString;
        trigger: z.ZodString;
        mitigation: z.ZodString;
        detection: z.ZodString;
    }, z.core.$strip>>;
    alternatives: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        reasonRejected: z.ZodString;
    }, z.core.$strip>>;
    openQuestions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        question: z.ZodString;
        owner: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type SpecArtifact = z.infer<typeof SpecArtifactSchema>;
