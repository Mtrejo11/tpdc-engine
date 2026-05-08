import { z } from "zod";

export const CapabilityStage = z.enum([
  "intake",
  "design",
  "decompose",
  "execute",
  "validate",
]);

export type CapabilityStage = z.infer<typeof CapabilityStage>;

export const CapabilityDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  stage: CapabilityStage,
  inputArtifact: z.string().min(1),
  outputArtifact: z.string().min(1),
  promptVersion: z.string().optional(),
  status: z.enum(["draft", "evaluated", "promoted", "deprecated"]),
});

export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;
