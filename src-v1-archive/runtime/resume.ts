/**
 * Resume a blocked workflow by injecting user answers into the design artifact
 * and re-running from the blocked stage onward.
 */

import { loadArtifact, saveArtifact } from "../storage/local";
import { loadRun } from "../storage/runs";
import { runWorkflow, WorkflowResult, WorkflowOptions } from "./workflow";

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
export async function resumeWorkflow(options: ResumeOptions): Promise<ResumeResult> {
  const { runId, answers, llm, quiet, apply, confirmApply, repoRoot } = options;

  // Load the blocked run
  const run = loadRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  // Check if the run is blocked — either at the workflow level or at any stage
  const hasBlockedStage = run.stages.some((s) => s.status === "blocked");
  if (run.finalVerdict !== "blocked" && !hasBlockedStage) {
    throw new Error(`Run ${runId} is not blocked (verdict: ${run.finalVerdict}). Only blocked runs can be resumed.`);
  }

  // Load the original intake artifact to get the base request
  const intake = loadArtifact(runId, "intake") as Record<string, unknown> | null;
  if (!intake) {
    throw new Error(`No intake artifact found for run ${runId}`);
  }

  // Load the design artifact to get the open questions
  const design = loadArtifact(runId, "design") as Record<string, unknown> | null;

  // Load decompose to get unresolved questions
  const decompose = loadArtifact(runId, "decompose") as Record<string, unknown> | null;

  // Collect all open questions from design and decompose
  const designQuestions = (design?.openQuestions as Array<{ question: string; owner: string; severity?: string }>) || [];
  const decomposeQuestions = (decompose?.unresolvedQuestions as Array<{ question: string; owner: string }>) || [];
  const allQuestions = [...designQuestions, ...decomposeQuestions];

  // Match answers to questions
  const resolvedQuestions: string[] = [];
  const resolvedAnswers: Array<{ question: string; answer: string }> = [];

  for (const answer of answers) {
    const matched = allQuestions.find((q) =>
      q.question.toLowerCase().includes(answer.question.toLowerCase()) ||
      answer.question.toLowerCase().includes(q.question.toLowerCase()),
    );
    if (matched) {
      resolvedQuestions.push(matched.question);
      resolvedAnswers.push({ question: matched.question, answer: answer.answer });
    } else {
      // No match — treat as additional context
      resolvedAnswers.push({ question: answer.question, answer: answer.answer });
    }
  }

  // Remaining unresolved questions
  const remainingQuestions = allQuestions
    .filter((q) => !resolvedQuestions.includes(q.question))
    .map((q) => q.question);

  // Build enriched request: original intake + resolved answers as additional context
  const resolvedContext = resolvedAnswers
    .map((a) => `[RESOLVED] ${a.question} → ${a.answer}`)
    .join("\n");

  const originalTitle = intake.title as string || "";
  const originalBody = intake.problem_statement as string || intake.body as string || "";

  const enrichedRequest = [
    originalTitle,
    "",
    originalBody,
    "",
    "## Previously Resolved Questions",
    "The following questions were raised in a prior analysis and have been answered:",
    "",
    resolvedContext,
    "",
    remainingQuestions.length > 0
      ? `Note: ${remainingQuestions.length} question(s) remain unresolved. Use reasonable defaults for these.`
      : "All prior open questions have been resolved.",
  ].join("\n");

  // Save resume context for traceability
  saveArtifact(runId, "resume", {
    originalRunId: runId,
    timestamp: new Date().toISOString(),
    answers,
    resolvedQuestions,
    remainingQuestions,
    enrichedRequest: enrichedRequest.substring(0, 500) + "...",
  });

  // Re-run the full workflow with enriched input
  const workflowResult = await runWorkflow(enrichedRequest, {
    llm,
    quiet,
    apply,
    confirmApply,
    repoRoot,
  });

  return {
    originalRunId: runId,
    newRunId: workflowResult.workflowId,
    workflowResult,
    resolvedQuestions,
    remainingQuestions,
  };
}
