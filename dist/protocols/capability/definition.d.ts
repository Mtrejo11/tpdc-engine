import { z } from "zod";
export declare const CapabilityStage: z.ZodEnum<{
    intake: "intake";
    design: "design";
    decompose: "decompose";
    execute: "execute";
    validate: "validate";
}>;
export type CapabilityStage = z.infer<typeof CapabilityStage>;
export declare const CapabilityDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodString;
    stage: z.ZodEnum<{
        intake: "intake";
        design: "design";
        decompose: "decompose";
        execute: "execute";
        validate: "validate";
    }>;
    inputArtifact: z.ZodString;
    outputArtifact: z.ZodString;
    promptVersion: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        deprecated: "deprecated";
        draft: "draft";
        evaluated: "evaluated";
        promoted: "promoted";
    }>;
}, z.core.$strip>;
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;
