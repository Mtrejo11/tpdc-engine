import { z } from "zod";

export const PromotionManifestSchema = z.object({
  capabilityId: z.string().min(1),
  version: z.string().min(1),
  approved: z.boolean(),
  evaluatedAt: z.string().datetime(),
  score: z.number().min(0).max(100),
  evaluator: z.string().min(1),
});

export type PromotionManifest = z.infer<typeof PromotionManifestSchema>;
