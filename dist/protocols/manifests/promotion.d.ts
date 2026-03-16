import { z } from "zod";
export declare const PromotionManifestSchema: z.ZodObject<{
    capabilityId: z.ZodString;
    version: z.ZodString;
    approved: z.ZodBoolean;
    evaluatedAt: z.ZodString;
    score: z.ZodNumber;
    evaluator: z.ZodString;
}, z.core.$strip>;
export type PromotionManifest = z.infer<typeof PromotionManifestSchema>;
