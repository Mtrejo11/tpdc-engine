import { z } from "zod";
export declare function saveArtifact(runId: string, capabilityId: string, data: unknown): string;
export declare function saveRawOutput(runId: string, capabilityId: string, raw: string): string;
export declare function loadArtifact(runId: string, capabilityId: string): unknown | null;
/**
 * Load and validate an artifact against a Zod schema.
 * Returns null if the artifact is missing, corrupt, or fails validation.
 */
export declare function loadTypedArtifact<T>(runId: string, capabilityId: string, schema: z.ZodType<T>): T | null;
