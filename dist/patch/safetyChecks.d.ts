/**
 * Patch safety boundary checks.
 *
 * Enforces configurable rules before any patch can be considered
 * for application. All checks are read-only — nothing is mutated.
 */
export interface SafetyConfig {
    /** Repo root — patches must not target files outside this */
    repoRoot: string;
    /** Glob patterns for denied file paths (e.g., ".env", "*.lock") */
    denyPatterns: string[];
    /** If set, only these paths are allowed (relative to repoRoot) */
    allowPaths?: string[];
    /** Maximum number of files a single PatchArtifact can target */
    maxTargetFiles: number;
    /** Maximum total diff size in characters across all patches */
    maxTotalDiffSize: number;
}
export interface SafetyViolation {
    patchIndex: number;
    filePath: string;
    rule: "denied_file" | "outside_repo" | "not_in_allowlist" | "max_files_exceeded" | "max_diff_exceeded";
    detail: string;
}
export interface SafetyResult {
    safe: boolean;
    violations: SafetyViolation[];
}
/** Default deny patterns for sensitive files */
export declare const DEFAULT_DENY_PATTERNS: string[];
/** Default safety config */
export declare function defaultSafetyConfig(repoRoot: string): SafetyConfig;
/**
 * Check a set of patches against safety rules.
 */
export declare function checkSafety(patches: Array<{
    filePath: string;
    diff: string;
}>, config: SafetyConfig): SafetyResult;
