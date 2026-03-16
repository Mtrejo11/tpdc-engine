/**
 * PlanSummaryArtifact — structured output for planning runs.
 *
 * Built by post-processing existing workflow artifacts (intake, design,
 * decompose) into a planning-oriented shape.
 */

import { RunSummary } from "../../storage/runs";
import { loadArtifact } from "../../storage/local";
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
  openQuestions: Array<{ question: string; owner: string }>;
  risks: Array<{ risk: string; mitigation?: string }>;
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
export function buildPlanArtifact(
  run: RunSummary,
  rawRequest: string,
  likelyCommand: PlanExecutionCommand,
): PlanSummaryArtifact {
  const intake = loadArtifact(run.workflowId, "intake") as Record<string, unknown> | null;
  const design = loadArtifact(run.workflowId, "design") as Record<string, unknown> | null;
  const decompose = loadArtifact(run.workflowId, "decompose") as Record<string, unknown> | null;
  const execute = loadArtifact(run.workflowId, "execute") as Record<string, unknown> | null;

  // Title
  const title = (intake?.title as string)
    || (design?.title as string)
    || rawRequest.substring(0, 80);

  // Objective — from intake problem_statement
  const objective = (intake?.problem_statement as string)
    || (intake?.observable_symptom as string)
    || rawRequest;

  // Scope — from design scope.inScope
  const designScope = design?.scope as { inScope?: string[]; outOfScope?: string[] } | undefined;
  const scope = designScope?.inScope || [];

  // Assumptions
  const assumptions = (intake?.assumptions as string[]) || [];

  // Open questions — merged
  const openQuestions = mergeQuestions(intake, design, decompose);

  // Risks — from design + decompose
  const risks = extractRisks(design, decompose);

  // Affected areas — from scope
  const affectedAreas = scope.length > 0 ? scope : extractAffectedAreas(intake, design);

  // Likely files — from execute/decompose
  const likelyFiles = extractLikelyFiles(execute, decompose, design);

  // Phases — from decompose steps
  const phases = extractPhases(decompose);

  // Dependencies — cross-step dependencies + external
  const dependencies = extractDependencies(decompose, design);

  // Validation approach — from decompose validationPlan + intake ACs
  const validationApproach = extractValidation(decompose, intake);

  // Readiness
  const { readiness, readinessReason } = determineReadiness(decompose, openQuestions, run);

  // Suggested next command
  const suggestedNextCommand = buildNextCommand(readiness, likelyCommand, title, rawRequest, objective);

  return {
    title,
    request: rawRequest,
    objective,
    scope,
    assumptions,
    openQuestions,
    risks,
    affectedAreas,
    likelyFiles,
    phases,
    dependencies,
    validationApproach,
    readiness,
    readinessReason,
    suggestedNextCommand,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

function mergeQuestions(
  ...sources: Array<Record<string, unknown> | null>
): Array<{ question: string; owner: string }> {
  const seen = new Set<string>();
  const result: Array<{ question: string; owner: string }> = [];

  for (const source of sources) {
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

function extractRisks(
  design: Record<string, unknown> | null,
  decompose: Record<string, unknown> | null,
): Array<{ risk: string; mitigation?: string }> {
  const risks: Array<{ risk: string; mitigation?: string }> = [];
  const seen = new Set<string>();

  // From design
  const designRisks = design?.risks as Array<{ risk: string; mitigation?: string }> | undefined;
  if (designRisks) {
    for (const r of designRisks) {
      if (!seen.has(r.risk)) {
        seen.add(r.risk);
        risks.push({ risk: r.risk, mitigation: r.mitigation });
      }
    }
  }

  // From decompose
  const decomposeRisks = decompose?.risks as Array<{ risk: string; mitigation?: string }> | undefined;
  if (decomposeRisks) {
    for (const r of decomposeRisks) {
      if (!seen.has(r.risk)) {
        seen.add(r.risk);
        risks.push({ risk: r.risk, mitigation: r.mitigation });
      }
    }
  }

  return risks;
}

function extractAffectedAreas(
  intake: Record<string, unknown> | null,
  design: Record<string, unknown> | null,
): string[] {
  const areas: string[] = [];

  // From design context
  const context = design?.context as string | string[] | undefined;
  if (context) {
    const items = Array.isArray(context) ? context : [context];
    for (const item of items.slice(0, 3)) {
      if (item.length <= 80) areas.push(item);
    }
  }

  return areas;
}

function extractLikelyFiles(
  execute: Record<string, unknown> | null,
  decompose: Record<string, unknown> | null,
  design: Record<string, unknown> | null,
): string[] {
  const files = new Set<string>();

  // From execute touchedArtifacts
  const touched = execute?.touchedArtifacts as Array<{ filePath: string }> | undefined;
  if (touched) {
    for (const t of touched) files.add(t.filePath);
  }

  // From decompose steps files
  const steps = decompose?.steps as Array<{ files?: string[] }> | undefined;
  if (steps) {
    for (const s of steps) {
      if (s.files) {
        for (const f of s.files) files.add(f);
      }
    }
  }

  // From design scope (file-like references)
  const scope = design?.scope as { inScope?: string[] } | undefined;
  if (scope?.inScope) {
    for (const item of scope.inScope) {
      const match = item.match(/\b((?:src|lib|app|components|services|hooks|utils|modules)\/[A-Za-z0-9_/.]+\.[a-z]+)\b/);
      if (match) files.add(match[1]);
    }
  }

  return Array.from(files);
}

function extractPhases(
  decompose: Record<string, unknown> | null,
): PlanPhase[] {
  const steps = decompose?.steps as Array<{
    stepNumber: number;
    title: string;
    goal?: string;
    files?: string[];
    dependsOn?: number[];
  }> | undefined;

  if (!steps || steps.length === 0) return [];

  return steps.map((s) => ({
    stepNumber: s.stepNumber,
    title: s.title,
    goal: s.goal || "",
    files: s.files || [],
    dependsOn: s.dependsOn || [],
  }));
}

function extractDependencies(
  decompose: Record<string, unknown> | null,
  design: Record<string, unknown> | null,
): string[] {
  const deps: string[] = [];

  // Cross-step dependencies
  const steps = decompose?.steps as Array<{ stepNumber: number; dependsOn?: number[]; title: string }> | undefined;
  if (steps) {
    for (const s of steps) {
      if (s.dependsOn && s.dependsOn.length > 0) {
        const depTitles = s.dependsOn
          .map((d) => steps.find((st) => st.stepNumber === d)?.title)
          .filter(Boolean);
        if (depTitles.length > 0) {
          deps.push(`Step ${s.stepNumber} (${s.title}) depends on: ${depTitles.join(", ")}`);
        }
      }
    }
  }

  // From design scope.outOfScope (external constraints)
  const scope = design?.scope as { outOfScope?: string[] } | undefined;
  if (scope?.outOfScope) {
    for (const item of scope.outOfScope.slice(0, 3)) {
      deps.push(`Out of scope: ${item}`);
    }
  }

  return deps;
}

function extractValidation(
  decompose: Record<string, unknown> | null,
  intake: Record<string, unknown> | null,
): string[] {
  const validation: string[] = [];

  // From decompose validationPlan
  const vp = decompose?.validationPlan as Array<{ ac?: string; verification?: string }> | undefined;
  if (vp) {
    for (const v of vp) {
      if (v.verification) {
        validation.push(v.verification.length > 120 ? v.verification.substring(0, 117) + "..." : v.verification);
      } else if (v.ac) {
        validation.push(`Verify: ${v.ac}`);
      }
    }
  }

  // Fallback: intake acceptance_criteria
  if (validation.length === 0) {
    const ac = intake?.acceptance_criteria as string[] | undefined;
    if (ac) {
      for (const criterion of ac) {
        validation.push(`Verify: ${criterion}`);
      }
    }
  }

  return validation;
}

function determineReadiness(
  decompose: Record<string, unknown> | null,
  openQuestions: Array<{ question: string; owner: string }>,
  run: RunSummary,
): { readiness: PlanReadiness; readinessReason: string } {
  const hasFailedStage = run.stages.some((s) => s.status === "failed");
  const decomposeStatus = decompose?.status as string | undefined;

  if (hasFailedStage) {
    return {
      readiness: "blocked",
      readinessReason: "Workflow failed — the plan cannot be produced until the issue is resolved.",
    };
  }

  if (decomposeStatus === "blocked") {
    const blockReason = decompose?.blockedReason as string | undefined;
    return {
      readiness: "blocked",
      readinessReason: blockReason
        ? `Plan blocked: ${blockReason.substring(0, 120)}`
        : "Plan blocked — insufficient context to produce actionable steps.",
    };
  }

  // Has blocking open questions
  const blockingQs = openQuestions.filter((q) => isBlockingQuestion(q.question));
  if (blockingQs.length > 0) {
    return {
      readiness: "needs_input",
      readinessReason: `${blockingQs.length} question(s) should be resolved before executing: ${blockingQs.map((q) => q.question.substring(0, 50)).join("; ")}.`,
    };
  }

  // Has steps → plan is actionable
  const steps = decompose?.steps as unknown[] | undefined;
  if (steps && steps.length > 0) {
    const infoQs = openQuestions.length - blockingQs.length;
    if (infoQs > 0) {
      return {
        readiness: "ready_to_execute",
        readinessReason: `Plan is actionable with ${steps.length} phase(s). ${infoQs} informational question(s) remain.`,
      };
    }
    return {
      readiness: "ready_to_execute",
      readinessReason: `Plan is actionable with ${steps.length} phase(s) and no blocking questions.`,
    };
  }

  // No steps but no failure — needs input
  if (openQuestions.length > 0) {
    return {
      readiness: "needs_input",
      readinessReason: `${openQuestions.length} open question(s) must be resolved to produce a plan.`,
    };
  }

  return {
    readiness: "ready_to_execute",
    readinessReason: "Plan is ready for execution.",
  };
}

function isBlockingQuestion(question: string): boolean {
  return /\b(which|what)\s+(platform|screen|component|module|database|service|api)\b/i.test(question)
    || /\b(what|how)\s+should\b/i.test(question)
    || /\bblock\w*\b/i.test(question)
    || /\bunknown|unclear|unspecified\b/i.test(question);
}

function buildNextCommand(
  readiness: PlanReadiness,
  likelyCommand: PlanExecutionCommand,
  title: string,
  rawRequest: string,
  objective: string,
): string {
  if (readiness === "blocked") {
    const desc = title.length <= 80 ? title : rawRequest.substring(0, 80);
    return `tpdc plan "${desc}" (re-run after resolving blockers)`;
  }

  // Use objective if it's richer than the title, otherwise use title
  let desc: string;
  if (objective.length > 30 && objective !== rawRequest) {
    desc = objective;
  } else {
    desc = title.length > 20 ? title : rawRequest;
  }

  // Clean up
  desc = desc.replace(/^(we\s+(will|should|need\s+to|want\s+to)\s+)/i, "");
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  desc = desc.trim().replace(/[.]+$/, "");

  if (desc.length > 150) {
    desc = desc.substring(0, 147) + "...";
  }

  return `tpdc ${likelyCommand} "${desc}"`;
}
