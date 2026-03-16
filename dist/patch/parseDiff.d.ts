/**
 * Unified diff parser.
 *
 * Converts unified diff strings from PatchArtifact into structured
 * patch operations that can be validated and later applied.
 */
export interface DiffHunk {
    /** Original file start line (1-based) */
    oldStart: number;
    /** Original file line count */
    oldCount: number;
    /** New file start line (1-based) */
    newStart: number;
    /** New file line count */
    newCount: number;
    /** Lines in this hunk: prefixed with ' ', '+', or '-' */
    lines: HunkLine[];
}
export interface HunkLine {
    type: "context" | "add" | "remove";
    content: string;
}
export interface ParsedPatch {
    oldPath: string;
    newPath: string;
    hunks: DiffHunk[];
}
export interface ParseError {
    message: string;
    line?: number;
}
export type ParseResult = {
    ok: true;
    patch: ParsedPatch;
} | {
    ok: false;
    error: ParseError;
};
/**
 * Parse a unified diff string into a structured ParsedPatch.
 *
 * Handles standard unified diff format:
 *   --- a/path
 *   +++ b/path
 *   @@ -old,count +new,count @@
 *   context/add/remove lines
 */
export declare function parseDiff(diff: string): ParseResult;
