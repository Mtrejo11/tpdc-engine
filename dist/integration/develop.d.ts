/**
 * Develop orchestrator — end-to-end development workflow.
 *
 * Orchestrates existing TPDC commands step by step.
 * Does NOT duplicate engine logic — calls dispatch() for each step.
 *
 * Modes:
 *   feature: discovery → plan → solve (with --apply if flags set)
 *   bug:     fix (with --apply if flags set)
 *   refactor: refactor (with --apply if flags set)
 *
 * Stopping rules:
 *   - discovery not ready → stop
 *   - plan blocked → stop
 *   - fix blocked → stop with suggested clarification
 *   - dry-run/preview fails → stop before apply
 *   - user declines confirmation → summarize without mutation
 */
import { DevelopMode, ParsedFlags } from "./parser";
import { DispatchOptions } from "./dispatcher";
export type DevelopStepStatus = "passed" | "blocked" | "failed" | "skipped" | "declined";
export interface DevelopStep {
    name: string;
    command: string;
    status: DevelopStepStatus;
    workflowId?: string;
    verdict?: string;
    score?: number;
    output: string;
    blockReason?: string;
}
export interface DevelopSummaryArtifact {
    mode: DevelopMode;
    request: string;
    stages: DevelopStep[];
    finalStatus: "completed" | "blocked" | "failed" | "declined";
    runIds: string[];
    applyResult?: {
        applied: boolean;
        branchName?: string;
        commitHash?: string;
        filesChanged?: string[];
    };
    validationResult?: {
        verdict?: string;
        score?: number;
    };
}
export interface DevelopResult {
    artifact: DevelopSummaryArtifact;
    output: string;
}
export declare function runDevelop(mode: DevelopMode, request: string, flags: ParsedFlags, options: DispatchOptions): Promise<DevelopResult>;
export declare function renderDevelopResult(artifact: DevelopSummaryArtifact): string;
