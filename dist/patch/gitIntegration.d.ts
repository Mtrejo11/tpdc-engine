/**
 * Git integration for patch apply.
 *
 * Wraps the existing applyPatches function with branch creation,
 * staging, and commit. Does not change patch application logic.
 */
import { ApplyOptions, ApplyResult } from "./applyPatch";
import { PatchInput } from "./dryRun";
export interface GitApplyOptions extends ApplyOptions {
    /** Run ID for branch naming and traceability */
    runId: string;
    /** Optional plan title for the commit message */
    planTitle?: string;
    /** Optional patch artifact reference (e.g., filename or path) */
    patchArtifactRef?: string;
    /** Short summary of what the patches do */
    changeSummary?: string;
}
export interface GitApplyResult {
    applyResult: ApplyResult;
    git: {
        branchCreated: boolean;
        branchName: string;
        commitCreated: boolean;
        commitHash: string;
        filesStaged: string[];
        errors: string[];
    };
}
export declare function buildBranchName(runId: string): string;
export declare function buildCommitMessage(applyResult: ApplyResult, options: {
    runId: string;
    patchArtifactRef?: string;
    planTitle?: string;
    changeSummary?: string;
    patchCount: number;
}): string;
/**
 * Apply patches with Git integration.
 *
 * Flow:
 * 1. Create branch from current HEAD
 * 2. Apply patches (delegates to existing applyPatches)
 * 3. If apply succeeded: stage changed files → commit
 * 4. If apply failed/rolled back: no git mutations, stay on original branch
 */
export declare function gitApplyPatches(patches: PatchInput[], options: GitApplyOptions): GitApplyResult;
