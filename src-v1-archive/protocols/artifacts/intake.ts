import { z } from "zod";

export const IntakeArtifactSchema = z.object({
  title: z.string().min(1).max(120),
  source_ticket: z.string().min(1).max(255),
  problem_statement: z.string().min(1).max(255),
  affected_users: z.string().min(1).max(255),
  observable_symptom: z.string().min(1).max(255),
  acceptance_criteria: z.array(z.string()).min(1),
  out_of_scope: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  open_questions: z.array(z.object({
    question: z.string(),
    owner: z.string(),
  })).optional(),
  success_metrics: z.array(z.string()).optional(),
  non_functional_constraints: z.array(z.string()).optional(),
});

export type IntakeArtifact = z.infer<typeof IntakeArtifactSchema>;
