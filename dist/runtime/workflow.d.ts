import { RunResult } from "./runCapability";
import { LLMAdapter } from "./types";
export type StageStatus = "passed" | "failed" | "blocked" | "skipped";
export interface StageResult {
    capabilityId: string;
    capabilityVersion: string;
    status: StageStatus;
    runResult?: RunResult;
    durationMs: number;
    blockReason?: string;
    validationErrors?: string[];
}
export interface MutationResult {
    enabled: boolean;
    patchGenerated: boolean;
    dryRunPassed: boolean;
    previewShown: boolean;
    applyConfirmed: boolean;
    /** How confirmation was obtained: "flag", "interactive", or "declined" */
    confirmationSource: "flag" | "interactive" | "declined" | "none";
    applied: boolean;
    branchName: string;
    commitHash: string;
    filesChanged: string[];
    rollbackTriggered: boolean;
    errors: string[];
}
export interface WorkflowResult {
    workflowId: string;
    timestamp: string;
    executionMode: "safe" | "mutation";
    adapter: {
        adapterId: string;
        modelId: string;
        transport: string;
    };
    stages: StageResult[];
    mutation?: MutationResult;
    finalVerdict: "pass" | "fail" | "blocked" | "inconclusive";
    totalDurationMs: number;
    summary: string;
}
export interface WorkflowOptions {
    llm: LLMAdapter;
    quiet?: boolean;
    /** Enable mutation mode (execute-patch → dry-run → apply → git) */
    apply?: boolean;
    /** Explicit confirmation for mutation — required alongside apply */
    confirmApply?: boolean;
    /** Enable interactive confirmation prompt (show preview + ask user) */
    interactive?: boolean;
    /** Repo root for patch generation and application */
    repoRoot?: string;
    /** Additional file hints for repo context */
    fileHints?: string[];
}
export declare function runWorkflow(request: unknown, options: WorkflowOptions): Promise<WorkflowResult>;
export declare function renderWorkflowSummary(result: WorkflowResult): string;
