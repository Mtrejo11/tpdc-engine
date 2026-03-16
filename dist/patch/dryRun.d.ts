/**
 * Dry-run validator for PatchArtifact.
 *
 * Checks whether each patch would apply cleanly against the current
 * working tree without actually modifying any files.
 */
import { SafetyConfig, SafetyViolation } from "./safetyChecks";
import { HunkRelocation } from "./fuzzyMatch";
export interface PatchCheckResult {
    patchIndex: number;
    filePath: string;
    operation: string;
    status: "applicable" | "conflict" | "missing_file" | "file_exists" | "malformed_diff";
    detail: string;
    /** Hunk relocation info when fuzzy matching was used */
    relocations?: HunkRelocation[];
}
export interface DryRunResult {
    safe: boolean;
    safetyViolations: SafetyViolation[];
    patchChecks: PatchCheckResult[];
    applicable: number;
    conflicts: number;
    errors: number;
    summary: string;
}
export interface PatchInput {
    filePath: string;
    operation: "create" | "modify" | "delete";
    diff: string;
}
/**
 * Run a complete dry-run validation of a PatchArtifact's patches.
 *
 * 1. Safety boundary checks (deny patterns, repo root, limits)
 * 2. Diff parsing validation
 * 3. Context matching against actual file contents
 */
export declare function dryRunValidate(patches: PatchInput[], safetyConfig: SafetyConfig): DryRunResult;
