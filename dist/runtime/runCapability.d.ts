import { LLMAdapter } from "./types";
export interface RunMetadata {
    runId: string;
    capabilityId: string;
    capabilityVersion: string;
    adapterId: string;
    modelId: string;
    transport: string;
    timestamp: string;
    validated: boolean;
    validationErrors: string[];
    durationMs: number;
}
export interface RunResult {
    runId: string;
    capabilityId: string;
    version: string;
    output: unknown;
    validated: boolean;
    validationErrors?: string[];
    savedTo: string;
    metadata: RunMetadata;
}
export declare function runCapability(capabilityId: string, input: unknown, options?: {
    version?: string;
    llm?: LLMAdapter;
    runId?: string;
    quiet?: boolean;
}): Promise<RunResult>;
