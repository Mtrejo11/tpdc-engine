"use strict";
/**
 * Lesson extraction from completed workflow runs.
 *
 * Derives reusable lessons from:
 * - blocked runs (missing context patterns)
 * - validate findings (repeated issues)
 * - dry-run failures (patch problems)
 * - mutation outcomes (apply patterns)
 * - successful executions (what worked)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLearnings = extractLearnings;
const local_1 = require("../storage/local");
function extractLearnings(run, command) {
    const lessons = [];
    const failurePatterns = [];
    const successPatterns = [];
    const suggestedHeuristics = [];
    const tags = [command, run.executionMode];
    // Load from disk artifacts (supplements RunSummary which is the primary source)
    const decompose = (0, local_1.loadArtifact)(run.workflowId, "decompose");
    const dryRun = (0, local_1.loadArtifact)(run.workflowId, "dry-run");
    const intake = (0, local_1.loadArtifact)(run.workflowId, "intake");
    // ── Blocked runs: extract missing context patterns ──
    if (run.blockReason) {
        const reason = run.blockReason.toLowerCase();
        if (reason.includes("platform") || reason.includes("ios") || reason.includes("android")) {
            failurePatterns.push("missing_platform");
            suggestedHeuristics.push("Requests involving mobile features should specify the target platform (iOS/Android/both)");
            tags.push("platform");
        }
        if (reason.includes("screen") || reason.includes("component") || reason.includes("module")) {
            failurePatterns.push("missing_component");
            suggestedHeuristics.push("Requests should identify the specific screen, component, or module affected");
            tags.push("component");
        }
        if (reason.includes("behavior") || reason.includes("expected")) {
            failurePatterns.push("missing_expected_behavior");
            suggestedHeuristics.push("Bug reports should describe both actual and expected behavior");
        }
        lessons.push(`Blocked: ${run.blockReason.substring(0, 150)}`);
    }
    // Decompose blocked reasons
    if (decompose?.status === "blocked") {
        const blockReason = decompose.blockedReason;
        if (blockReason && !lessons.some((l) => l.includes(blockReason.substring(0, 50)))) {
            lessons.push(`Decompose blocked: ${blockReason.substring(0, 150)}`);
        }
        // Extract unresolved questions as patterns
        const questions = decompose.unresolvedQuestions;
        if (questions) {
            for (const q of questions) {
                if (/platform|ios|android/i.test(q.question))
                    failurePatterns.push("missing_platform");
                if (/which\s+(screen|component|module|service)/i.test(q.question))
                    failurePatterns.push("missing_component");
                if (/what\s+(database|storage|backend)/i.test(q.question))
                    failurePatterns.push("missing_infrastructure");
            }
        }
    }
    // ── Validate findings (from RunSummary — always available) ──
    if (run.findings) {
        for (const f of run.findings) {
            if (f.severity === "critical") {
                failurePatterns.push(`critical_${f.category}`);
                lessons.push(`Critical finding (${f.category}): ${f.description.substring(0, 120)}`);
            }
            if (f.category === "patch_grounding") {
                failurePatterns.push("patch_grounding_failure");
                suggestedHeuristics.push("Patch generation should verify file context lines against actual file content before submission");
            }
            if (f.category === "apply_integrity") {
                failurePatterns.push("apply_integrity_failure");
                suggestedHeuristics.push("Dry-run conflicts often indicate line-number drift — use fuzzy matching or re-read file before patching");
            }
            tags.push(f.category);
        }
    }
    if (run.score !== undefined) {
        if (run.score >= 80) {
            successPatterns.push("high_score");
            tags.push("high_quality");
        }
        else if (run.score < 50) {
            failurePatterns.push("low_score");
            tags.push("low_quality");
        }
    }
    // ── Dry-run failures ──
    if (dryRun) {
        const safe = dryRun.safe;
        const applicable = dryRun.applicable;
        const conflicts = dryRun.conflicts;
        if (safe === false) {
            failurePatterns.push("dry_run_safety_violation");
            lessons.push("Dry-run safety check failed — patches touched denied paths or exceeded limits");
        }
        if (conflicts && conflicts > 0) {
            failurePatterns.push("dry_run_conflict");
            lessons.push(`Dry-run found ${conflicts} conflict(s) — context lines did not match file content`);
            suggestedHeuristics.push("When generating patches, verify context lines are current — stale context causes conflicts");
        }
        if (applicable === 0) {
            failurePatterns.push("zero_applicable_patches");
            lessons.push("No patches were applicable — all hunks conflicted or were rejected");
        }
    }
    // ── Mutation outcomes ──
    if (run.mutation) {
        if (run.mutation.applied) {
            successPatterns.push("mutation_applied");
            if (run.mutation.filesChanged.length > 0) {
                lessons.push(`Successfully applied patches to ${run.mutation.filesChanged.length} file(s)`);
            }
        }
        if (run.mutation.rollbackTriggered) {
            failurePatterns.push("rollback_triggered");
            lessons.push("Mutation was rolled back after apply failure");
        }
        if (run.mutation.errors.length > 0) {
            for (const err of run.mutation.errors) {
                failurePatterns.push("mutation_error");
                lessons.push(`Mutation error: ${err.substring(0, 100)}`);
            }
        }
    }
    // ── Successful execution patterns ──
    if (run.finalVerdict === "pass") {
        successPatterns.push(`${command}_pass`);
        // Extract what made it work from intake structure
        if (intake) {
            const hasAC = intake.acceptance_criteria?.length;
            const hasAssumptions = intake.assumptions?.length;
            if (hasAC && hasAC > 0)
                successPatterns.push("clear_acceptance_criteria");
            if (hasAssumptions && hasAssumptions > 0)
                successPatterns.push("explicit_assumptions");
        }
    }
    // ── Tag by outcome ──
    tags.push(run.finalVerdict);
    // Deduplicate
    const uniqueFailures = [...new Set(failurePatterns)];
    const uniqueSuccess = [...new Set(successPatterns)];
    const uniqueTags = [...new Set(tags)];
    return {
        runId: run.workflowId,
        command,
        mode: run.executionMode,
        outcome: run.finalVerdict,
        lessons,
        failurePatterns: uniqueFailures,
        successPatterns: uniqueSuccess,
        suggestedHeuristics: [...new Set(suggestedHeuristics)],
        tags: uniqueTags,
        timestamp: run.timestamp,
    };
}
//# sourceMappingURL=extract.js.map