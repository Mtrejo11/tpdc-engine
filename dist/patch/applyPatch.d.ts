/**
 * Patch applicator with rollback support.
 *
 * Applies validated patches to the working tree. Requires a successful
 * dry-run result before any mutation is allowed.
 *
 * If any patch fails mid-apply, all mutations are reverted.
 */
import { DryRunResult, PatchInput } from "./dryRun";
export interface ApplyOptions {
    /** Absolute path to repo root */
    repoRoot: string;
    /** Require explicit confirmation — apply refuses to run without this */
    confirmed: boolean;
    /** Dry-run result that must have passed */
    dryRunResult: DryRunResult;
}
export interface FileApplyResult {
    patchIndex: number;
    filePath: string;
    operation: "create" | "modify" | "delete";
    status: "applied" | "skipped" | "failed";
    detail: string;
}
export interface ApplyResult {
    applyId: string;
    timestamp: string;
    repoRoot: string;
    status: "applied" | "partial" | "failed" | "rejected" | "rolled_back";
    filesAttempted: number;
    filesChanged: number;
    fileResults: FileApplyResult[];
    rollback: {
        triggered: boolean;
        filesReverted: number;
        status: "not_needed" | "success" | "failed";
        errors: string[];
    };
    errors: string[];
}
/**
 * Apply validated patches to the working tree.
 *
 * Preconditions:
 * - `options.confirmed` must be true
 * - `options.dryRunResult.safe` must be true
 * - Only patches with dry-run status `applicable` will be applied
 *
 * On failure: all mutations are rolled back.
 */
export declare function applyPatches(patches: PatchInput[], options: ApplyOptions): ApplyResult;
