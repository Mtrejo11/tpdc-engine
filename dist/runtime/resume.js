"use strict";
/**
 * Resume a blocked workflow by injecting user answers into the design artifact
 * and re-running from the blocked stage onward.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumeWorkflow = resumeWorkflow;
const local_1 = require("../storage/local");
const runs_1 = require("../storage/runs");
const workflow_1 = require("./workflow");
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
async function resumeWorkflow(options) {
    const { runId, answers, llm, quiet, apply, confirmApply, repoRoot } = options;
    // Load the blocked run
    const run = (0, runs_1.loadRun)(runId);
    if (!run) {
        throw new Error(`Run not found: ${runId}`);
    }
    // Check if the run is blocked — either at the workflow level or at any stage
    const hasBlockedStage = run.stages.some((s) => s.status === "blocked");
    if (run.finalVerdict !== "blocked" && !hasBlockedStage) {
        throw new Error(`Run ${runId} is not blocked (verdict: ${run.finalVerdict}). Only blocked runs can be resumed.`);
    }
    // Load the original intake artifact to get the base request
    const intake = (0, local_1.loadArtifact)(runId, "intake");
    if (!intake) {
        throw new Error(`No intake artifact found for run ${runId}`);
    }
    // Load the design artifact to get the open questions
    const design = (0, local_1.loadArtifact)(runId, "design");
    // Load decompose to get unresolved questions
    const decompose = (0, local_1.loadArtifact)(runId, "decompose");
    // Collect all open questions from design and decompose
    const designQuestions = design?.openQuestions || [];
    const decomposeQuestions = decompose?.unresolvedQuestions || [];
    const allQuestions = [...designQuestions, ...decomposeQuestions];
    // Match answers to questions
    const resolvedQuestions = [];
    const resolvedAnswers = [];
    for (const answer of answers) {
        const matched = allQuestions.find((q) => q.question.toLowerCase().includes(answer.question.toLowerCase()) ||
            answer.question.toLowerCase().includes(q.question.toLowerCase()));
        if (matched) {
            resolvedQuestions.push(matched.question);
            resolvedAnswers.push({ question: matched.question, answer: answer.answer });
        }
        else {
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
    const originalTitle = intake.title || "";
    const originalBody = intake.problem_statement || intake.body || "";
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
    (0, local_1.saveArtifact)(runId, "resume", {
        originalRunId: runId,
        timestamp: new Date().toISOString(),
        answers,
        resolvedQuestions,
        remainingQuestions,
        enrichedRequest: enrichedRequest.substring(0, 500) + "...",
    });
    // Re-run the full workflow with enriched input
    const workflowResult = await (0, workflow_1.runWorkflow)(enrichedRequest, {
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
//# sourceMappingURL=resume.js.map