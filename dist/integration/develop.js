"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDevelop = runDevelop;
exports.renderDevelopResult = renderDevelopResult;
const parser_1 = require("./parser");
const dispatcher_1 = require("./dispatcher");
const runs_1 = require("../storage/runs");
const local_1 = require("../storage/local");
// ── Orchestrator ─────────────────────────────────────────────────────
async function runDevelop(mode, request, flags, options) {
    switch (mode) {
        case "feature":
            return runFeatureFlow(request, flags, options);
        case "bug":
            return runBugFlow(request, flags, options);
        case "refactor":
            return runRefactorFlow(request, flags, options);
    }
}
// ── Feature flow ─────────────────────────────────────────────────────
// discovery → plan → solve (with mutation flags)
async function runFeatureFlow(request, flags, options) {
    const steps = [];
    const runIds = [];
    // Step 1: Discovery
    const discoveryStep = await runStep("Discovery", "discovery", request, {}, options);
    steps.push(discoveryStep);
    if (discoveryStep.workflowId)
        runIds.push(discoveryStep.workflowId);
    // Check discovery readiness
    if (discoveryStep.status !== "passed") {
        return buildResult("feature", request, steps, runIds, "blocked");
    }
    const discoveryReady = checkDiscoveryReadiness(discoveryStep.workflowId);
    if (!discoveryReady.ready) {
        discoveryStep.status = "blocked";
        discoveryStep.blockReason = discoveryReady.reason;
        return buildResult("feature", request, steps, runIds, "blocked");
    }
    // Step 2: Plan
    const planStep = await runStep("Plan", "plan", request, {}, options);
    steps.push(planStep);
    if (planStep.workflowId)
        runIds.push(planStep.workflowId);
    if (planStep.status !== "passed") {
        return buildResult("feature", request, steps, runIds, "blocked");
    }
    const planReady = checkPlanReadiness(planStep.workflowId);
    if (!planReady.ready) {
        planStep.status = "blocked";
        planStep.blockReason = planReady.reason;
        return buildResult("feature", request, steps, runIds, "blocked");
    }
    // Step 3: Solve (with mutation flags if provided)
    const solveStep = await runStep("Solve", "solve", request, flags, options);
    steps.push(solveStep);
    if (solveStep.workflowId)
        runIds.push(solveStep.workflowId);
    const finalStatus = determineFinalStatus(solveStep, flags);
    const result = buildResult("feature", request, steps, runIds, finalStatus);
    // Enrich with mutation/validation data from the solve run
    enrichFromRun(result.artifact, solveStep.workflowId);
    return result;
}
// ── Bug flow ─────────────────────────────────────────────────────────
// fix (with mutation flags)
async function runBugFlow(request, flags, options) {
    const steps = [];
    const runIds = [];
    // Step 1: Fix
    const fixStep = await runStep("Fix", "fix", request, flags, options);
    steps.push(fixStep);
    if (fixStep.workflowId)
        runIds.push(fixStep.workflowId);
    // Check if blocked (missing bug context)
    if (fixStep.verdict === "blocked" || fixStep.verdict === "inconclusive") {
        fixStep.status = "blocked";
        fixStep.blockReason = extractBlockReason(fixStep.workflowId);
        return buildResult("bug", request, steps, runIds, "blocked");
    }
    const finalStatus = determineFinalStatus(fixStep, flags);
    const result = buildResult("bug", request, steps, runIds, finalStatus);
    enrichFromRun(result.artifact, fixStep.workflowId);
    return result;
}
// ── Refactor flow ────────────────────────────────────────────────────
// refactor (with mutation flags)
async function runRefactorFlow(request, flags, options) {
    const steps = [];
    const runIds = [];
    // Step 1: Refactor
    const refactorStep = await runStep("Refactor", "refactor", request, flags, options);
    steps.push(refactorStep);
    if (refactorStep.workflowId)
        runIds.push(refactorStep.workflowId);
    const finalStatus = determineFinalStatus(refactorStep, flags);
    const result = buildResult("refactor", request, steps, runIds, finalStatus);
    enrichFromRun(result.artifact, refactorStep.workflowId);
    return result;
}
// ── Step runner ──────────────────────────────────────────────────────
async function runStep(name, command, request, flags, options) {
    try {
        const result = await (0, dispatcher_1.dispatch)({ command: (0, parser_1.toCommand)(command), args: request, flags }, options);
        const status = result.error ? "failed"
            : result.verdict === "blocked" || result.verdict === "inconclusive" ? "blocked"
                : "passed";
        return {
            name,
            command,
            status,
            workflowId: result.workflowId,
            verdict: result.verdict,
            score: result.score,
            output: result.output,
            blockReason: result.error,
        };
    }
    catch (err) {
        return {
            name,
            command,
            status: "failed",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            blockReason: err instanceof Error ? err.message : String(err),
        };
    }
}
// ── Readiness checks ─────────────────────────────────────────────────
function checkDiscoveryReadiness(workflowId) {
    if (!workflowId)
        return { ready: false, reason: "No workflow ID from discovery" };
    const artifact = (0, local_1.loadArtifact)(workflowId, "discovery");
    if (!artifact) {
        // No discovery artifact — check workflow verdict
        const run = (0, runs_1.loadRun)(workflowId);
        if (run && run.finalVerdict === "pass")
            return { ready: true, reason: "Workflow passed" };
        return { ready: false, reason: "Discovery did not produce an artifact" };
    }
    const readiness = artifact.readiness;
    const reason = artifact.readinessReason || "";
    if (readiness === "ready_for_execution") {
        return { ready: true, reason };
    }
    return { ready: false, reason: reason || `Discovery readiness: ${readiness}` };
}
function checkPlanReadiness(workflowId) {
    if (!workflowId)
        return { ready: false, reason: "No workflow ID from plan" };
    const artifact = (0, local_1.loadArtifact)(workflowId, "plan");
    if (!artifact) {
        const run = (0, runs_1.loadRun)(workflowId);
        if (run && run.finalVerdict === "pass")
            return { ready: true, reason: "Workflow passed" };
        return { ready: false, reason: "Plan did not produce an artifact" };
    }
    const readiness = artifact.readiness;
    const reason = artifact.readinessReason || "";
    if (readiness === "ready_to_execute") {
        return { ready: true, reason };
    }
    return { ready: false, reason: reason || `Plan readiness: ${readiness}` };
}
function extractBlockReason(workflowId) {
    if (!workflowId)
        return "Unknown blocking reason";
    const run = (0, runs_1.loadRun)(workflowId);
    return run?.blockReason || run?.summary || "Unknown blocking reason";
}
// ── Helpers ──────────────────────────────────────────────────────────
function determineFinalStatus(lastStep, flags) {
    if (lastStep.status === "failed")
        return "failed";
    if (lastStep.status === "blocked")
        return "blocked";
    // Check if mutation was declined
    if (flags.apply && lastStep.workflowId) {
        const run = (0, runs_1.loadRun)(lastStep.workflowId);
        if (run?.mutation) {
            if (run.mutation.confirmationSource === "declined" || run.mutation.confirmationSource === "none") {
                return "declined";
            }
        }
    }
    return "completed";
}
function enrichFromRun(artifact, workflowId) {
    if (!workflowId)
        return;
    const run = (0, runs_1.loadRun)(workflowId);
    if (!run)
        return;
    if (run.mutation) {
        artifact.applyResult = {
            applied: run.mutation.applied,
            branchName: run.mutation.branchName || undefined,
            commitHash: run.mutation.commitHash || undefined,
            filesChanged: run.mutation.filesChanged.length > 0 ? run.mutation.filesChanged : undefined,
        };
    }
    if (run.score !== undefined || run.finalVerdict) {
        artifact.validationResult = {
            verdict: run.finalVerdict,
            score: run.score,
        };
    }
}
function buildResult(mode, request, steps, runIds, finalStatus) {
    const artifact = {
        mode,
        request,
        stages: steps,
        finalStatus,
        runIds,
    };
    // Persist the develop artifact under the last run's directory
    const lastRunId = runIds[runIds.length - 1];
    if (lastRunId) {
        try {
            (0, local_1.saveArtifact)(lastRunId, "develop", artifact);
        }
        catch {
            // Best-effort
        }
    }
    const output = renderDevelopResult(artifact);
    return { artifact, output };
}
// ── Renderer ─────────────────────────────────────────────────────────
function renderDevelopResult(artifact) {
    const lines = [];
    const statusIcon = artifact.finalStatus === "completed" ? "✅"
        : artifact.finalStatus === "blocked" ? "⚠️"
            : artifact.finalStatus === "declined" ? "⊘"
                : "❌";
    const statusLabel = artifact.finalStatus.toUpperCase();
    const modeLabel = artifact.mode.toUpperCase();
    lines.push("");
    lines.push(`  ${statusIcon} DEVELOP ${modeLabel} — ${statusLabel}`);
    lines.push(`  ${"═".repeat(52)}`);
    lines.push("");
    // Request
    lines.push("  Request");
    lines.push(`  ${"─".repeat(52)}`);
    wrapText(artifact.request, 64).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
    // Steps
    lines.push(`  Steps (${artifact.stages.length})`);
    lines.push(`  ${"─".repeat(52)}`);
    for (let i = 0; i < artifact.stages.length; i++) {
        const step = artifact.stages[i];
        const icon = stepIcon(step.status);
        const scoreStr = step.score !== undefined ? ` (${step.score}/100)` : "";
        lines.push(`  ${i + 1}. ${icon} ${step.name}  ${step.status}${scoreStr}`);
        if (step.blockReason) {
            wrapText(step.blockReason, 58).forEach((l) => lines.push(`     ${l}`));
        }
    }
    lines.push("");
    // Apply result
    if (artifact.applyResult) {
        const a = artifact.applyResult;
        lines.push("  Apply Result");
        lines.push(`  ${"─".repeat(52)}`);
        lines.push(`  Applied: ${a.applied ? "yes" : "no"}`);
        if (a.branchName)
            lines.push(`  Branch:  ${a.branchName}`);
        if (a.commitHash)
            lines.push(`  Commit:  ${a.commitHash.substring(0, 12)}`);
        if (a.filesChanged && a.filesChanged.length > 0) {
            lines.push(`  Files:   ${a.filesChanged.length}`);
            for (const f of a.filesChanged) {
                lines.push(`    · ${f}`);
            }
        }
        lines.push("");
    }
    // Validation
    if (artifact.validationResult) {
        const v = artifact.validationResult;
        if (v.verdict || v.score !== undefined) {
            lines.push("  Validation");
            lines.push(`  ${"─".repeat(52)}`);
            if (v.verdict)
                lines.push(`  Verdict: ${v.verdict.toUpperCase()}`);
            if (v.score !== undefined)
                lines.push(`  Score:   ${v.score}/100`);
            lines.push("");
        }
    }
    // Blocked step detail (show last step output if blocked)
    if (artifact.finalStatus === "blocked") {
        const blockedStep = artifact.stages.find((s) => s.status === "blocked");
        if (blockedStep) {
            lines.push(`  Blocked at: ${blockedStep.name}`);
            lines.push(`  ${"─".repeat(52)}`);
            if (blockedStep.blockReason) {
                wrapText(blockedStep.blockReason, 64).forEach((l) => lines.push(`  ${l}`));
            }
            lines.push("");
            // Show open questions and resume hint
            const lastRunId = artifact.runIds[artifact.runIds.length - 1];
            if (lastRunId) {
                const openQuestions = extractOpenQuestions(lastRunId);
                if (openQuestions.length > 0) {
                    lines.push(`  Open Questions (${openQuestions.length})`);
                    lines.push(`  ${"─".repeat(52)}`);
                    for (let i = 0; i < openQuestions.length; i++) {
                        const q = openQuestions[i];
                        const sevLabel = q.severity ? ` [${q.severity}]` : "";
                        lines.push(`  ${i + 1}. ${q.question}${sevLabel}`);
                        lines.push(`     Owner: ${q.owner}`);
                    }
                    lines.push("");
                    lines.push("  To unblock, use tpdc_unblock with the run ID and");
                    lines.push("  answers to the open questions above.");
                    lines.push("");
                }
            }
        }
    }
    // Run IDs
    if (artifact.runIds.length > 0) {
        lines.push("  Run IDs");
        lines.push(`  ${"─".repeat(52)}`);
        for (const id of artifact.runIds) {
            lines.push(`  · ${id}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
function stepIcon(status) {
    switch (status) {
        case "passed": return "✓";
        case "blocked": return "⊘";
        case "failed": return "✗";
        case "skipped": return "·";
        case "declined": return "⊘";
    }
}
function extractOpenQuestions(runId) {
    const questions = [];
    // Check design artifact for open questions
    const design = (0, local_1.loadArtifact)(runId, "design");
    if (design?.openQuestions) {
        const dq = design.openQuestions;
        for (const q of dq) {
            questions.push(q);
        }
    }
    // Check decompose artifact for unresolved questions
    const decompose = (0, local_1.loadArtifact)(runId, "decompose");
    if (decompose?.unresolvedQuestions) {
        const uq = decompose.unresolvedQuestions;
        for (const q of uq) {
            // Avoid duplicates
            if (!questions.some((existing) => existing.question === q.question)) {
                questions.push(q);
            }
        }
    }
    return questions;
}
function wrapText(text, width) {
    const lines = [];
    const words = text.split(" ");
    let current = "";
    for (const word of words) {
        if (current.length + word.length + 1 > width) {
            lines.push(current);
            current = word;
        }
        else {
            current += (current ? " " : "") + word;
        }
    }
    if (current)
        lines.push(current);
    return lines;
}
//# sourceMappingURL=develop.js.map