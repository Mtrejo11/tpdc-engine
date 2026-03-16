/**
 * PlanSummaryArtifact — structured output for planning runs.
 *
 * Built by post-processing existing workflow artifacts (intake, design,
 * decompose) into a planning-oriented shape.
 */
import { RunSummary } from "../../storage/runs";
import { PlanExecutionCommand } from "./planNormalizer";
export type PlanReadiness = "ready_to_execute" | "needs_input" | "blocked";
export interface PlanPhase {
    stepNumber: number;
    title: string;
    goal: string;
    files: string[];
    dependsOn: number[];
}
export interface PlanSummaryArtifact {
    title: string;
    request: string;
    objective: string;
    scope: string[];
    assumptions: string[];
    openQuestions: Array<{
        question: string;
        owner: string;
    }>;
    risks: Array<{
        risk: string;
        mitigation?: string;
    }>;
    affectedAreas: string[];
    likelyFiles: string[];
    phases: PlanPhase[];
    dependencies: string[];
    validationApproach: string[];
    readiness: PlanReadiness;
    readinessReason: string;
    suggestedNextCommand: string;
}
/**
 * Build a PlanSummaryArtifact from existing workflow artifacts.
 */
export declare function buildPlanArtifact(run: RunSummary, rawRequest: string, likelyCommand: PlanExecutionCommand): PlanSummaryArtifact;
