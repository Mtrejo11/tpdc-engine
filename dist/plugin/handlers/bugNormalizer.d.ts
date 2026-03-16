/**
 * Bug report normalizer.
 *
 * Extracts structured bug context from free-text descriptions
 * before passing to the workflow. Does NOT invent missing data —
 * preserves gaps so the workflow blocks correctly.
 */
export interface BugContext {
    /** Normalized request string to pass to the workflow */
    normalizedRequest: string;
    /** Structured fields extracted from the raw input */
    extracted: {
        platform?: string;
        screen?: string;
        actualBehavior?: string;
        expectedBehavior?: string;
        reproContext?: string;
    };
    /** Fields that could not be extracted from the input */
    missingFields: string[];
    /** The original raw input */
    rawInput: string;
}
/**
 * Parse a free-text bug description into structured context.
 * Extraction is best-effort using keyword/pattern matching.
 * Missing fields are tracked but never fabricated.
 */
export declare function normalizeBugReport(raw: string): BugContext;
/**
 * Generate a suggested clarified bug report from what was extracted
 * and what was missing.
 */
export declare function suggestClarifiedReport(ctx: BugContext): string;
