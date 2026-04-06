/**
 * Execute Patch Mode — repo-aware patch generation.
 *
 * Wraps runCapability("execute-patch") with repo context injection.
 * Does NOT apply patches. Output is a PatchArtifact.
 *
 * Supports chunked mode: when the plan has multiple steps, generates
 * patches per-step with scoped repo context, then merges results.
 * This prevents LLM timeouts on large plans.
 */
import { RunResult } from "./runCapability";
import { LLMAdapter } from "./types";
export interface ExecutePatchOptions {
    llm: LLMAdapter;
    repoRoot: string;
    fileHints?: string[];
    runId?: string;
    quiet?: boolean;
    /** Force single-shot mode even with multiple steps */
    chunked?: boolean;
}
export declare function executePatch(planArtifact: Record<string, unknown>, options: ExecutePatchOptions): Promise<RunResult>;
