import { z } from "zod";
export declare const IntakeArtifactSchema: z.ZodObject<{
    title: z.ZodString;
    source_ticket: z.ZodString;
    problem_statement: z.ZodString;
    affected_users: z.ZodString;
    observable_symptom: z.ZodString;
    acceptance_criteria: z.ZodArray<z.ZodString>;
    out_of_scope: z.ZodOptional<z.ZodArray<z.ZodString>>;
    assumptions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    open_questions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        question: z.ZodString;
        owner: z.ZodString;
    }, z.core.$strip>>>;
    success_metrics: z.ZodOptional<z.ZodArray<z.ZodString>>;
    non_functional_constraints: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type IntakeArtifact = z.infer<typeof IntakeArtifactSchema>;
