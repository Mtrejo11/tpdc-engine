import { z } from "zod";

export const SpecArtifactSchema = z.object({
  title: z.string().min(1),
  status: z.enum(["proposed", "accepted", "superseded", "deprecated"]),
  date: z.string().min(1),
  sourceTicket: z.string().min(1),
  context: z.array(z.string()).min(1),
  decision: z.string().min(1),
  scope: z.object({
    inScope: z.array(z.string()).min(1),
    outOfScope: z.array(z.string()).min(1),
  }),
  validationPlan: z.array(z.object({
    ac: z.string().min(1),
    verification: z.string().min(1),
  })).min(1),
  risks: z.array(z.object({
    risk: z.string().min(1),
    trigger: z.string().min(1),
    mitigation: z.string().min(1),
    detection: z.string().min(1),
  })).min(3),
  alternatives: z.array(z.object({
    name: z.string().min(1),
    reasonRejected: z.string().min(1),
  })).min(2),
  openQuestions: z.array(z.object({
    question: z.string().min(1),
    owner: z.string().min(1),
  })).optional(),
});

export type SpecArtifact = z.infer<typeof SpecArtifactSchema>;
