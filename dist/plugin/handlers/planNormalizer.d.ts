/**
 * Plan request normalizer.
 *
 * Tags the request as a planning exercise and detects
 * the likely execution command for the suggested next step.
 */
export type PlanExecutionCommand = "solve" | "fix" | "refactor" | "migrate";
export interface PlanContext {
    /** Normalized request string to pass to the workflow */
    normalizedRequest: string;
    /** Detected likely execution command */
    likelyCommand: PlanExecutionCommand;
    /** The original raw input */
    rawInput: string;
}
export declare function normalizePlan(raw: string): PlanContext;
