import { z } from "zod";

export const RequestArtifactSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  body: z.string().min(1),
  source: z.string().optional(),
  projectContext: z.object({
    techStack: z.string().optional(),
    constraints: z.array(z.string()).optional(),
    repo: z.string().optional(),
  }).optional(),
  createdAt: z.string().datetime(),
});

export type RequestArtifact = z.infer<typeof RequestArtifactSchema>;
