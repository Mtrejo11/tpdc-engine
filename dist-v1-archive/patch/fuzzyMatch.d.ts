/**
 * Conservative fuzzy hunk relocation.
 *
 * When a diff hunk's absolute line number is wrong but the surrounding
 * context lines match real file content elsewhere, this module locates
 * the correct position. It is intentionally strict:
 *
 *  - All context + remove lines must match consecutively.
 *  - Only ONE candidate position is accepted. Multiple matches → ambiguous → reject.
 *  - Search window is bounded (default ±500 lines from the hunk's claimed position).
 *  - Trailing whitespace tolerance mirrors the existing dry-run behavior.
 */
import { DiffHunk } from "./parseDiff";
export interface HunkRelocation {
    hunkIndex: number;
    /** Original oldStart from the diff (1-based) */
    originalStart: number;
    /** Actual position found in the file (1-based) */
    relocatedStart: number;
    /** relocatedStart - originalStart */
    offset: number;
    /** "exact" if the original line number was already correct */
    confidence: "exact" | "fuzzy";
}
export type RelocationResult = {
    ok: true;
    relocations: HunkRelocation[];
} | {
    ok: false;
    detail: string;
};
export interface FuzzyMatchOptions {
    /** Maximum lines to search above and below the claimed position. Default 500. */
    maxSearchRadius?: number;
}
/**
 * Relocate all hunks in a parsed diff against actual file contents.
 *
 * For each hunk:
 * 1. Try the exact line number first.
 * 2. If that fails, search outward from the claimed position within the radius.
 * 3. Require exactly one match — zero or multiple means failure.
 *
 * Returns relocated positions for ALL hunks, or a descriptive failure.
 */
export declare function relocateHunks(hunks: DiffHunk[], fileLines: string[], options?: FuzzyMatchOptions): RelocationResult;
