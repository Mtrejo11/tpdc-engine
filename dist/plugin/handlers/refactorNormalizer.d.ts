/**
 * Refactor request normalizer.
 *
 * Tags the request as a structural improvement and extracts
 * the refactor category to guide the workflow and renderer.
 */
export type RefactorCategory = "extraction" | "decomposition" | "consolidation" | "simplification" | "architecture" | "general";
export interface RefactorContext {
    /** Normalized request string to pass to the workflow */
    normalizedRequest: string;
    /** Detected refactor category */
    category: RefactorCategory;
    /** Target modules/components/files if detected */
    targets: string[];
    /** The original raw input */
    rawInput: string;
}
export declare function normalizeRefactor(raw: string): RefactorContext;
