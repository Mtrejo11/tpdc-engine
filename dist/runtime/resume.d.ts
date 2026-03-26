/**
 * Resume a blocked workflow by injecting user answers into the design artifact
 * and re-running from the blocked stage onward.
 */
import { WorkflowResult, WorkflowOptions } from "./workflow";
export interface ResumeAnswer {
    /** The original question text (or substring match) */
    question: string;
    /** The user's answer */
    answer: string;
}
export interface ResumeOptions {
    runId: string;
    answers: ResumeAnswer[];
    llm: WorkflowOptions["llm"];
    quiet?: boolean;
    apply?: boolean;
    confirmApply?: boolean;
    repoRoot?: string;
}
export interface ResumeResult {
    originalRunId: string;
    newRunId: string;
    workflowResult: WorkflowResult;
    resolvedQuestions: string[];
    remainingQuestions: string[];
}
/**
 * Resume a blocked workflow run.
 *
 * Strategy:
 * 1. Load the design artifact from the blocked run
 * 2. Patch it: move answered questions from openQuestions into the decision as resolved assumptions
 * 3. Re-run the full pipeline with the enriched request (intake output + resolved answers)
 *
 * We re-run from intake because the design prompt needs to see the answers
 * to produce a clean ADR without the blocking questions.
 */
export declare function resumeWorkflow(options: ResumeOptions): Promise<ResumeResult>;
