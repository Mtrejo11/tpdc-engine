/**
 * Run inspection helpers.
 *
 * Loads and summarises completed workflow runs from the artifacts directory.
 */
export interface RunSummary {
    workflowId: string;
    timestamp: string;
    executionMode: "safe" | "mutation";
    adapter: {
        adapterId: string;
        modelId: string;
        transport: string;
    };
    finalVerdict: string;
    totalDurationMs: number;
    summary: string;
    stages: Array<{
        capabilityId: string;
        status: string;
        durationMs: number;
        blockReason?: string;
    }>;
    score?: number;
    findings?: Array<{
        category: string;
        severity: string;
        description: string;
    }>;
    openQuestions?: Array<{
        question: string;
        owner: string;
    }>;
    blockReason?: string;
    originalRequest?: string;
    mutation?: {
        applied: boolean;
        branchName: string;
        commitHash: string;
        filesChanged: string[];
        patchGenerated: boolean;
        dryRunPassed: boolean;
        confirmationSource: string;
        rollbackTriggered: boolean;
        errors: string[];
    };
    artifactPaths: string[];
}
export declare function loadRun(runId: string): RunSummary | null;
export declare function listRuns(): string[];
export declare function resolveRunId(partial: string): string | null;
