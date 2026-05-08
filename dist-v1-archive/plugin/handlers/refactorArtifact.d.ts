/**
 * RefactorArtifact — structured output for refactor runs.
 *
 * Built by post-processing existing workflow artifacts (intake, design,
 * decompose, execute) into a refactor-specific shape.
 */
import { RunSummary } from "../../storage/runs";
import { RefactorCategory } from "./refactorNormalizer";
export type RefactorRiskLevel = "low" | "medium" | "high";
export interface RefactorArtifact {
    targets: string[];
    category: RefactorCategory;
    structuralIssues: string[];
    strategy: string;
    affectedFiles: string[];
    expectedBenefits: string[];
    riskLevel: RefactorRiskLevel;
    riskReason: string;
}
/**
 * Build a RefactorArtifact from existing workflow artifacts.
 */
export declare function buildRefactorArtifact(run: RunSummary, rawRequest: string, category: RefactorCategory, detectedTargets: string[]): RefactorArtifact;
