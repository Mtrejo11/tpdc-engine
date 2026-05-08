import { z } from "zod";

const StepResultSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().min(1),
  status: z.enum(["completed", "partial", "skipped", "blocked"]),
  changeSummary: z.string().min(1),
  touchedArtifacts: z.array(z.string()).optional(),
  evidence: z.string().min(1),
  blockedReason: z.string().optional(),
});

export const ExecutionArtifactSchema = z.object({
  sourceTicket: z.string().min(1),
  planTitle: z.string().min(1),
  status: z.enum(["completed", "partial", "failed", "blocked"]),
  appliedChangesSummary: z.string().min(1),
  touchedArtifacts: z.array(z.string()).min(1),
  evidence: z.array(z.string()).min(1),
  stepResults: z.array(StepResultSchema).min(1),
  notes: z.string().optional(),
});

export type StepResult = z.infer<typeof StepResultSchema>;
export type ExecutionArtifact = z.infer<typeof ExecutionArtifactSchema>;
