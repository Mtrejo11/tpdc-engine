import { z } from "zod";

const PatchItemSchema = z.object({
  stepNumber: z.number().int().positive(),
  filePath: z.string().min(1),
  operation: z.enum(["create", "modify", "delete"]),
  diff: z.string().min(1),
  justification: z.string().min(1),
});

export const PatchArtifactSchema = z.object({
  sourceTicket: z.string().min(1),
  planTitle: z.string().min(1),
  executionMode: z.literal("patch"),
  executionStatus: z.enum(["completed", "partial", "blocked", "insufficient_context"]),
  targetFiles: z.array(z.string()).min(1),
  changeSummary: z.string().min(1),
  patches: z.array(PatchItemSchema).optional(),
  assumptions: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  blockedReason: z.string().optional(),
  missingContext: z.array(z.string()).optional(),
  notes: z.string().optional(),
}).refine(
  (data) => {
    if (data.executionStatus === "blocked") {
      return !!data.blockedReason;
    }
    if (data.executionStatus === "insufficient_context") {
      return !!data.missingContext && data.missingContext.length > 0;
    }
    if (data.executionStatus === "completed" || data.executionStatus === "partial") {
      return !!data.patches && data.patches.length > 0;
    }
    return false;
  },
  {
    message:
      "Blocked requires blockedReason. Insufficient context requires missingContext. Completed/partial require patches.",
  },
);

export type PatchItem = z.infer<typeof PatchItemSchema>;
export type PatchArtifact = z.infer<typeof PatchArtifactSchema>;
