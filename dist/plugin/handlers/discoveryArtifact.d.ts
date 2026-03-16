/**
 * DiscoveryArtifact — structured output for discovery runs.
 *
 * Built by post-processing existing workflow artifacts (intake, design,
 * decompose) into a discovery-specific shape.
 */
import { RunSummary } from "../../storage/runs";
import { SuggestedCommand } from "./discoveryNormalizer";
export type Readiness = "ready_for_execution" | "needs_input" | "not_ready";
export interface DiscoveryOption {
    name: string;
    reasonRejected?: string;
}
export interface Tradeoff {
    option: string;
    advantages: string[];
    disadvantages: string[];
}
export interface ClassifiedQuestion {
    question: string;
    owner: string;
    classification: "critical" | "informational";
}
export interface DiscoveryArtifact {
    title: string;
    idea: string;
    problemFraming: string;
    affectedAreas: string[];
    constraints: string[];
    assumptions: string[];
    openQuestions: Array<{
        question: string;
        owner: string;
    }>;
    criticalQuestions: ClassifiedQuestion[];
    informationalQuestions: ClassifiedQuestion[];
    risks: Array<{
        risk: string;
        trigger?: string;
        mitigation?: string;
    }>;
    options: DiscoveryOption[];
    tradeoffs: Tradeoff[];
    recommendation: string;
    decisionDrivers: string[];
    impactAreas: string[];
    readiness: Readiness;
    readinessReason: string;
    suggestedNextCommand: string;
}
export declare function classifyQuestion(q: {
    question: string;
    owner: string;
}): ClassifiedQuestion;
/**
 * Build a DiscoveryArtifact from existing workflow artifacts.
 * Does not call the LLM — just reshapes what's already persisted.
 */
export declare function buildDiscoveryArtifact(run: RunSummary, rawIdea: string, likelyCommand: SuggestedCommand): DiscoveryArtifact;
