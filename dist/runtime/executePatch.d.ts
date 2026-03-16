/**
 * Execute Patch Mode — repo-aware patch generation.
 *
 * Wraps runCapability("execute-patch") with repo context injection.
 * Does NOT apply patches. Output is a PatchArtifact.
 */
import { RunResult } from "./runCapability";
import { LLMAdapter } from "./types";
export interface ExecutePatchOptions {
    llm: LLMAdapter;
    repoRoot: string;
    fileHints?: string[];
    runId?: string;
    quiet?: boolean;
}
export declare function executePatch(planArtifact: Record<string, unknown>, options: ExecutePatchOptions): Promise<RunResult>;
