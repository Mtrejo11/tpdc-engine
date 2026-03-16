/**
 * DiscoveryArtifact — structured output for discovery runs.
 *
 * Built by post-processing existing workflow artifacts (intake, design,
 * decompose) into a discovery-specific shape.
 */

import { RunSummary } from "../../storage/runs";
import { loadArtifact } from "../../storage/local";
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
  openQuestions: Array<{ question: string; owner: string }>;
  criticalQuestions: ClassifiedQuestion[];
  informationalQuestions: ClassifiedQuestion[];
  risks: Array<{ risk: string; trigger?: string; mitigation?: string }>;
  options: DiscoveryOption[];
  tradeoffs: Tradeoff[];
  recommendation: string;
  decisionDrivers: string[];
  impactAreas: string[];
  readiness: Readiness;
  readinessReason: string;
  suggestedNextCommand: string;
}

// ── Question classification ──────────────────────────────────────────

/**
 * Patterns that signal a question is blocking for implementation.
 * If a question matches any of these, it's critical.
 */
const CRITICAL_PATTERNS: RegExp[] = [
  // Unknown target / platform
  /\b(which|what)\s+(platform|os|device|target|environment)\b/i,
  /\b(ios|android|web|desktop|mobile)\b.*\b(or|\/)\b/i,
  /\bplatform\b.*\b(unknown|unclear|unspecified|affected)\b/i,
  /\baffected\b.*\b(platform|surface)\b/i,

  // Unknown component / screen / module
  /\b(which|what)\s+(screen|component|module|service|file|endpoint|page|view)\b/i,
  /\b(where|which)\s+(feature|flow|code|function)\b/i,

  // Unknown desired behavior
  /\b(what|how)\s+should\b/i,
  /\bexpected\s+(behavior|result|outcome|state)\b/i,
  /\bdesired\s+(behavior|result|outcome|state)\b/i,

  // Missing key system constraints
  /\b(which|what)\s+(database|storage|api|auth|backend|infrastructure)\b/i,
  /\bcritical\b.*\b(constraint|requirement|dependency)\b/i,
  /\bblock(s|ing|ed)?\b/i,
  /\bmust\b.*\b(before|first|prior)\b/i,

  // Unknown scope
  /\b(scope|boundary|limit)\b.*\b(unknown|unclear|undefined)\b/i,
];

export function classifyQuestion(
  q: { question: string; owner: string },
): ClassifiedQuestion {
  const isCritical = CRITICAL_PATTERNS.some((p) => p.test(q.question));
  return {
    question: q.question,
    owner: q.owner,
    classification: isCritical ? "critical" : "informational",
  };
}

// ── Artifact builder ─────────────────────────────────────────────────

/**
 * Build a DiscoveryArtifact from existing workflow artifacts.
 * Does not call the LLM — just reshapes what's already persisted.
 */
export function buildDiscoveryArtifact(
  run: RunSummary,
  rawIdea: string,
  likelyCommand: SuggestedCommand,
): DiscoveryArtifact {
  const intake = loadArtifact(run.workflowId, "intake") as Record<string, unknown> | null;
  const design = loadArtifact(run.workflowId, "design") as Record<string, unknown> | null;
  const decompose = loadArtifact(run.workflowId, "decompose") as Record<string, unknown> | null;

  // Title
  const title = (intake?.title as string)
    || (design?.title as string)
    || rawIdea.substring(0, 80);

  // Problem framing — from intake problem_statement + context
  const problemStatement = intake?.problem_statement as string || "";
  const designContext = design?.context as string | string[] | undefined;
  const contextStr = Array.isArray(designContext)
    ? designContext.join(" ")
    : designContext || "";
  const problemFraming = problemStatement || contextStr || rawIdea;

  // Affected areas — from design scope.inScope
  const scope = design?.scope as { inScope?: string[]; outOfScope?: string[] } | undefined;
  const affectedAreas = scope?.inScope || [];

  // Constraints — from intake non_functional_constraints + scope.outOfScope
  const nfc = (intake?.non_functional_constraints as string[]) || [];
  const outOfScope = scope?.outOfScope || [];
  const constraints = [
    ...nfc,
    ...outOfScope.map((s) => `Out of scope: ${s}`),
  ];

  // Assumptions — from intake
  const assumptions = (intake?.assumptions as string[]) || [];

  // Open questions — merged from intake + design + decompose
  const openQuestions = mergeQuestions(intake, design, decompose);

  // Classify questions
  const classified = openQuestions.map(classifyQuestion);
  const criticalQuestions = classified.filter((q) => q.classification === "critical");
  const informationalQuestions = classified.filter((q) => q.classification === "informational");

  // Risks — from design
  const risks = ((design?.risks as Array<{
    risk: string; trigger?: string; mitigation?: string;
  }>) || []).map((r) => ({
    risk: r.risk,
    trigger: r.trigger,
    mitigation: r.mitigation,
  }));

  // Options — from design alternatives
  const alternatives = (design?.alternatives as DiscoveryOption[]) || [];

  // Tradeoffs — derived from alternatives + decision
  const tradeoffs = buildTradeoffs(alternatives, design);

  // Recommendation + decision drivers
  const recommendation = (design?.decision as string) || "";
  const decisionDrivers = extractDecisionDrivers(recommendation, design, problemFraming);

  // Impact areas — systems that will likely change
  const impactAreas = extractImpactAreas(affectedAreas, design, intake);

  // Readiness — semantic classification based on question criticality
  const { readiness, readinessReason } = determineReadiness(
    decompose,
    criticalQuestions,
    informationalQuestions,
    run,
  );

  // Suggested next command — natural, specific, copy-paste ready
  const suggestedNextCommand = buildNextCommand(
    readiness,
    likelyCommand,
    title,
    rawIdea,
    recommendation,
    problemFraming,
    affectedAreas,
    risks,
  );

  return {
    title,
    idea: rawIdea,
    problemFraming,
    affectedAreas,
    constraints,
    assumptions,
    openQuestions,
    criticalQuestions,
    informationalQuestions,
    risks,
    options: alternatives,
    tradeoffs,
    recommendation,
    decisionDrivers,
    impactAreas,
    readiness,
    readinessReason,
    suggestedNextCommand,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

function mergeQuestions(
  intake: Record<string, unknown> | null,
  design: Record<string, unknown> | null,
  decompose: Record<string, unknown> | null,
): Array<{ question: string; owner: string }> {
  const seen = new Set<string>();
  const result: Array<{ question: string; owner: string }> = [];

  for (const source of [intake, design, decompose]) {
    const questions = (source?.open_questions || source?.openQuestions || source?.unresolvedQuestions) as
      Array<{ question: string; owner: string }> | undefined;
    if (questions) {
      for (const q of questions) {
        if (!seen.has(q.question)) {
          seen.add(q.question);
          result.push(q);
        }
      }
    }
  }

  return result;
}

function buildTradeoffs(
  alternatives: DiscoveryOption[],
  design: Record<string, unknown> | null,
): Tradeoff[] {
  const tradeoffs: Tradeoff[] = [];

  // Add rejected alternatives with their rejection reasons as disadvantages
  for (const alt of alternatives) {
    const advantages: string[] = [];
    const disadvantages: string[] = [];

    if (alt.reasonRejected) {
      disadvantages.push(alt.reasonRejected);
    } else {
      advantages.push("Considered viable — no explicit drawbacks identified");
    }

    tradeoffs.push({
      option: alt.name,
      advantages,
      disadvantages,
    });
  }

  // Add the recommended approach with its reasoning as advantages
  const decision = design?.decision as string | undefined;
  if (decision) {
    const actionPart = extractActionPhrase(decision);
    const reasonPart = extractBecauseClause(decision);

    if (actionPart && actionPart.length > 20) {
      const advantages: string[] = [];

      // The "because" clause explains why the recommendation wins
      if (reasonPart) {
        advantages.push(reasonPart);
      }

      // Also pull in risk mitigations that this approach addresses
      const risks = design?.risks as Array<{ risk: string; mitigation?: string }> | undefined;
      if (risks) {
        for (const r of risks.slice(0, 2)) {
          if (r.mitigation && !advantages.some((a) => a.includes(r.mitigation!.substring(0, 30)))) {
            advantages.push(`Addresses risk: ${r.risk.substring(0, 80)}`);
          }
        }
      }

      tradeoffs.unshift({
        option: `${actionPart} (recommended)`,
        advantages,
        disadvantages: [],
      });
    }
  }

  return tradeoffs;
}

/**
 * Extract decision drivers — the reasons the recommendation was chosen.
 *
 * Derives from:
 * 1. The recommendation's "because" clause (if present and relevant)
 * 2. Risk mitigations that the recommendation addresses
 * 3. Constraints that shaped the decision
 *
 * Validates relevance by checking overlap with the problem framing
 * to prevent cross-contamination from unrelated text.
 */
function extractDecisionDrivers(
  recommendation: string,
  design: Record<string, unknown> | null,
  problemFraming?: string,
): string[] {
  const drivers: string[] = [];

  // 1. Extract from "because" clause — but keep it as one coherent reason
  //    instead of splitting on commas (which breaks mid-sentence)
  const becauseClause = extractBecauseClause(recommendation);
  if (becauseClause && becauseClause.length > 20) {
    // Validate relevance: the because-clause should relate to the problem domain
    // by sharing meaningful words with the recommendation's action part
    const actionPart = extractActionPhrase(recommendation);
    if (actionPart && hasTopicOverlap(becauseClause, actionPart)) {
      drivers.push(becauseClause);
    }
    // If no overlap with the action, it's likely contaminated — skip it
  }

  // 2. Risk mitigations as drivers (these are always run-specific)
  const risks = design?.risks as Array<{ risk: string; mitigation?: string }> | undefined;
  if (risks) {
    for (const r of risks.slice(0, 3)) {
      if (r.mitigation && !drivers.some((d) => d.includes(r.mitigation!.substring(0, 30)))) {
        drivers.push(`Mitigates: ${r.risk.substring(0, 100)}`);
      }
    }
  }

  // 3. Constraints that shaped the decision
  const scope = design?.scope as { outOfScope?: string[] } | undefined;
  if (scope?.outOfScope && scope.outOfScope.length > 0) {
    drivers.push(`Scoped to avoid: ${scope.outOfScope.slice(0, 2).join("; ")}`);
  }

  return drivers;
}

/**
 * Extract impact areas — human-readable descriptions of systems
 * that will likely change.
 *
 * Prefers the full affected-area descriptions rather than extracting
 * individual tech-keyword tags.
 */
function extractImpactAreas(
  affectedAreas: string[],
  design: Record<string, unknown> | null,
  intake: Record<string, unknown> | null,
): string[] {
  const impact: string[] = [];
  const seen = new Set<string>();

  // Use affected areas directly — they're already descriptive
  for (const area of affectedAreas) {
    // Normalize to lowercase for dedup
    const normalized = area.toLowerCase().substring(0, 80);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      impact.push(area.length > 80 ? area.substring(0, 77) + "..." : area);
    }
  }

  // Supplement from risk mitigations (often name concrete subsystems)
  const risks = design?.risks as Array<{ risk: string; mitigation?: string }> | undefined;
  if (risks) {
    for (const r of risks) {
      if (r.mitigation) {
        const normalized = r.mitigation.toLowerCase().substring(0, 80);
        if (!seen.has(normalized) && impact.length < 8) {
          seen.add(normalized);
          impact.push(r.mitigation.length > 80 ? r.mitigation.substring(0, 77) + "..." : r.mitigation);
        }
      }
    }
  }

  return impact;
}

function determineReadiness(
  decompose: Record<string, unknown> | null,
  criticalQuestions: ClassifiedQuestion[],
  informationalQuestions: ClassifiedQuestion[],
  run: RunSummary,
): { readiness: Readiness; readinessReason: string } {
  const decomposeStatus = decompose?.status as string | undefined;
  const hasFailedStage = run.stages.some((s) => s.status === "failed");

  // Not ready: failed stages
  if (hasFailedStage) {
    return {
      readiness: "not_ready",
      readinessReason: "Workflow failed — the idea may need more fundamental rethinking.",
    };
  }

  // Needs input: critical questions remain
  if (criticalQuestions.length > 0) {
    const plural = criticalQuestions.length === 1 ? "" : "s";
    return {
      readiness: "needs_input",
      readinessReason: `${criticalQuestions.length} critical question${plural} must be resolved before execution: ${criticalQuestions.map((q) => q.question.substring(0, 60)).join("; ")}.`,
    };
  }

  // Decompose explicitly blocked (even without critical questions detected)
  if (decomposeStatus === "blocked") {
    const blockReason = decompose?.blockedReason as string | undefined;
    return {
      readiness: "needs_input",
      readinessReason: blockReason
        ? `Decompose blocked: ${blockReason.substring(0, 120)}`
        : "Decompose blocked — additional context required.",
    };
  }

  // Only informational questions remain → ready
  if (informationalQuestions.length > 0) {
    return {
      readiness: "ready_for_execution",
      readinessReason: `Ready to execute. ${informationalQuestions.length} informational question(s) remain but are not blocking.`,
    };
  }

  // No questions at all → ready
  return {
    readiness: "ready_for_execution",
    readinessReason: "The idea is well-framed and can proceed to execution.",
  };
}

function buildNextCommand(
  readiness: Readiness,
  likelyCommand: SuggestedCommand,
  title: string,
  rawIdea: string,
  recommendation: string,
  problemFraming: string,
  affectedAreas: string[],
  risks: Array<{ risk: string }>,
): string {
  if (readiness === "not_ready") {
    const desc = title.length <= 80 ? title : rawIdea.substring(0, 80);
    return `tpdc discovery "${desc}" (re-run after rethinking)`;
  }

  // Build a natural, specific, copy-paste-ready command description
  // Strategy: action (from recommendation) + context (from problem/areas) + purpose (from risks)
  const action = extractActionPhrase(recommendation);
  const context = synthesizeContext(title, problemFraming, affectedAreas);
  const purpose = synthesizePurpose(problemFraming, risks);

  let desc: string;

  if (action && action.length >= 20) {
    // We have a concrete action from the recommendation
    // Check if the action already contains enough context
    if (action.length >= 60 || containsContext(action, affectedAreas)) {
      desc = action;
    } else {
      // Append purpose/context to make it specific
      if (purpose && action.length + purpose.length < 170) {
        desc = `${action} to ${purpose}`;
      } else if (context) {
        desc = `${action} in ${context}`;
      } else {
        desc = action;
      }
    }
  } else {
    // No recommendation — build from title + purpose
    if (purpose) {
      desc = `${title} by ${purpose}`;
    } else {
      desc = title;
    }
  }

  // Clean up and cap length
  desc = desc.trim().replace(/[,;.]+$/, "");
  if (desc.length > 180) {
    // Truncate at the last word boundary before 180
    desc = desc.substring(0, 177).replace(/\s+\S*$/, "...");
  }

  return `tpdc ${likelyCommand} "${desc}"`;
}

/**
 * Extract the action phrase from a recommendation string.
 * Strips "We will/should" prefixes and "because" clauses.
 */
function extractActionPhrase(text: string): string | null {
  if (!text || text.length < 20) return null;

  // Remove "because" clause (both " — because" and standalone "because")
  let action = text.split(/\s+—\s+because\b/i)[0];
  action = action.split(/\bbecause\b/i)[0];

  // Remove leading "We will/should/recommend to"
  action = action.replace(/^(we\s+(will|should|recommend\s+to?)\s+)/i, "");

  // Capitalize first letter
  action = action.charAt(0).toUpperCase() + action.slice(1);
  action = action.trim().replace(/[,;.]+$/, "");

  if (action.length < 15) return null;
  if (action.length > 150) action = action.substring(0, 147) + "...";

  return action;
}

/**
 * Extract the "because" clause from a recommendation.
 */
function extractBecauseClause(text: string): string | null {
  // Try " — because" first (more structured)
  const dashMatch = text.match(/\s+—\s+because\s+(.+)/i);
  if (dashMatch) return dashMatch[1].trim().replace(/\.$/, "");

  // Try standalone "because"
  const match = text.match(/\bbecause\s+(.+)/i);
  if (match) return match[1].trim().replace(/\.$/, "");

  return null;
}

/**
 * Check if two text fragments share meaningful content words,
 * indicating they're about the same topic.
 */
function hasTopicOverlap(a: string, b: string): boolean {
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "and", "or", "not",
    "that", "this", "it", "its", "will", "can", "should", "must", "has", "have",
    "does", "do", "did", "if", "but", "as", "so", "than", "then", "when", "which"]);

  const wordsA = new Set(
    a.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !stopWords.has(w)),
  );
  const wordsB = new Set(
    b.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !stopWords.has(w)),
  );

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  // Require at least 2 shared content words or 20% overlap
  return overlap >= 2 || (wordsA.size > 0 && overlap / wordsA.size >= 0.2);
}

function synthesizeContext(
  title: string,
  problemFraming: string,
  affectedAreas: string[],
): string | null {
  // Pick the most specific area name that's concise
  const conciseAreas = affectedAreas.filter((a) => a.length <= 50);
  if (conciseAreas.length > 0) {
    return conciseAreas[0];
  }
  return null;
}

function synthesizePurpose(
  problemFraming: string,
  risks: Array<{ risk: string }>,
): string | null {
  // Derive a "to prevent X" or "to address Y" purpose from the problem
  if (problemFraming && problemFraming.length > 20 && problemFraming.length <= 100) {
    // Use the problem framing as the purpose, rephrased
    const lower = problemFraming.toLowerCase();
    if (lower.includes("cannot") || lower.includes("no way") || lower.includes("locked")) {
      return `address: ${problemFraming.substring(0, 80)}`;
    }
    return `prevent ${problemFraming.substring(0, 80).toLowerCase()}`;
  }

  // Fallback: use the top risk
  if (risks.length > 0) {
    const topRisk = risks[0].risk;
    if (topRisk.length <= 80) {
      return `mitigate ${topRisk.toLowerCase()}`;
    }
  }

  return null;
}

function containsContext(action: string, affectedAreas: string[]): boolean {
  const lower = action.toLowerCase();
  return affectedAreas.some((area) => {
    const areaWords = area.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    return areaWords.some((w) => lower.includes(w));
  });
}
