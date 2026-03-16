/**
 * Plugin handler: workflow execution
 *
 * Thin wrapper over the existing runWorkflow orchestrator.
 * Enriches the result with per-stage artifact data for rendering.
 */
import { LLMAdapter } from "../../runtime/types";
export interface WorkflowCommandInput {
    text: string;
    title?: string;
}
export interface StageDetail {
    capabilityId: string;
    status: string;
    durationMs: number;
    blockReason?: string;
    validationErrors?: string[];
}
export interface WorkflowCommandResult {
    workflowId: string;
    request: string;
    timestamp: string;
    adapter: {
        adapterId: string;
        modelId: string;
        transport: string;
    };
    stages: StageDetail[];
    finalVerdict: string;
    totalDurationMs: number;
    summary: string;
    score?: number;
    openQuestions?: Array<{
        question: string;
        owner: string;
    }>;
    findings?: Array<{
        category: string;
        severity: string;
        description: string;
    }>;
    blockReason?: string;
}
export declare function runWorkflowHandler(input: WorkflowCommandInput, options: {
    llm: LLMAdapter;
    quiet?: boolean;
}): Promise<WorkflowCommandResult>;
