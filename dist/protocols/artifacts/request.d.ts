import { z } from "zod";
export declare const RequestArtifactSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    body: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
    projectContext: z.ZodOptional<z.ZodObject<{
        techStack: z.ZodOptional<z.ZodString>;
        constraints: z.ZodOptional<z.ZodArray<z.ZodString>>;
        repo: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type RequestArtifact = z.infer<typeof RequestArtifactSchema>;
