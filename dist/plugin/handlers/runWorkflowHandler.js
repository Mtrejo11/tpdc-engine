"use strict";
/**
 * Plugin handler: workflow execution
 *
 * Thin wrapper over the existing runWorkflow orchestrator.
 * Enriches the result with per-stage artifact data for rendering.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkflowHandler = runWorkflowHandler;
const workflow_1 = require("../../runtime/workflow");
const local_1 = require("../../storage/local");
async function runWorkflowHandler(input, options) {
    // Build request — plain string or structured object with title
    const request = input.title
        ? { title: input.title, body: input.text, source: "plugin" }
        : input.text;
    // Delegate to existing orchestrator — no workflow logic here
    const result = await (0, workflow_1.runWorkflow)(request, {
        llm: options.llm,
        quiet: options.quiet ?? true,
    });
    // Enrich with data from saved artifacts
    const enriched = enrichFromArtifacts(result);
    return {
        workflowId: result.workflowId,
        request: input.text,
        timestamp: result.timestamp,
        adapter: result.adapter,
        stages: result.stages.map((s) => ({
            capabilityId: s.capabilityId,
            status: s.status,
            durationMs: s.durationMs,
            blockReason: s.blockReason,
            validationErrors: s.validationErrors,
        })),
        finalVerdict: result.finalVerdict,
        totalDurationMs: result.totalDurationMs,
        summary: result.summary,
        ...enriched,
    };
}
/**
 * Load saved stage artifacts to extract open questions, findings, and score.
 * This reads from disk — the same artifacts the orchestrator already persisted.
 */
function enrichFromArtifacts(result) {
    const enriched = {};
    // Extract open questions from decompose artifact
    const decompose = (0, local_1.loadArtifact)(result.workflowId, "decompose");
    if (decompose) {
        if (decompose.status === "blocked" && decompose.blockedReason) {
            enriched.blockReason = decompose.blockedReason;
        }
        const questions = decompose.unresolvedQuestions;
        if (questions && questions.length > 0) {
            enriched.openQuestions = questions;
        }
    }
    // Extract score and findings from validate artifact
    const validate = (0, local_1.loadArtifact)(result.workflowId, "validate");
    if (validate) {
        if (typeof validate.score === "number") {
            enriched.score = validate.score;
        }
        const findings = validate.findings;
        if (findings && findings.length > 0) {
            enriched.findings = findings;
        }
    }
    return enriched;
}
//# sourceMappingURL=runWorkflowHandler.js.map