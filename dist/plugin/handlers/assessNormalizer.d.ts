/**
 * Assessment request normalizer.
 *
 * Tags the request as an analysis/audit and extracts the assessment
 * category so the workflow and renderer can specialize output.
 */
export type AssessmentCategory = "security" | "performance" | "architecture" | "general";
export interface AssessmentContext {
    /** Normalized request string to pass to the workflow */
    normalizedRequest: string;
    /** Detected assessment category */
    category: AssessmentCategory;
    /** The original raw input */
    rawInput: string;
}
export declare function normalizeAssessment(raw: string): AssessmentContext;
