"use strict";
/**
 * Renderer for `tpdc refactor` output.
 *
 * Emphasizes structural improvements, affected files,
 * risk level, and expected benefits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRefactorResult = renderRefactorResult;
function renderRefactorResult(run, artifact) {
    const lines = [];
    const v = run.finalVerdict.toUpperCase();
    const icon = run.finalVerdict === "pass" ? "✅"
        : run.finalVerdict === "fail" ? "❌"
            : run.finalVerdict === "blocked" ? "⚠️"
                : "❔";
    lines.push("");
    lines.push(`  ${icon} REFACTOR PLAN — ${v}`);
    lines.push(`  ${"═".repeat(52)}`);
    lines.push("");
    // Targets
    lines.push("  Target");
    lines.push(`  ${"─".repeat(52)}`);
    if (artifact.targets.length === 1) {
        lines.push(`  ${truncate(artifact.targets[0], 66)}`);
    }
    else {
        for (const t of artifact.targets) {
            lines.push(`  · ${truncate(t, 64)}`);
        }
    }
    lines.push(`  Category: ${categoryLabel(artifact.category)}`);
    if (run.score !== undefined) {
        lines.push(`  Score: ${run.score}/100`);
    }
    lines.push(`  Duration: ${formatDuration(run.totalDurationMs)}`);
    lines.push("");
    // Refactor Risk
    lines.push("  Refactor Risk");
    lines.push(`  ${"─".repeat(52)}`);
    lines.push(`  Level: ${riskIcon(artifact.riskLevel)} ${artifact.riskLevel.toUpperCase()}`);
    lines.push(`  Reason: ${truncate(artifact.riskReason, 60)}`);
    lines.push("");
    // Problems detected
    if (artifact.structuralIssues.length > 0) {
        lines.push("  Problems Detected");
        lines.push(`  ${"─".repeat(52)}`);
        for (const issue of artifact.structuralIssues) {
            wrapText(issue, 64).forEach((l, i) => {
                lines.push(i === 0 ? `  ▸ ${l}` : `    ${l}`);
            });
        }
        lines.push("");
    }
    // Refactor strategy
    if (artifact.strategy) {
        lines.push("  Refactor Strategy");
        lines.push(`  ${"─".repeat(52)}`);
        wrapText(artifact.strategy, 64).forEach((l) => lines.push(`  ${l}`));
        lines.push("");
    }
    // Files affected
    if (artifact.affectedFiles.length > 0) {
        lines.push(`  Files Affected (${artifact.affectedFiles.length})`);
        lines.push(`  ${"─".repeat(52)}`);
        for (const f of artifact.affectedFiles) {
            lines.push(`  · ${f}`);
        }
        lines.push("");
    }
    // Expected benefits
    if (artifact.expectedBenefits.length > 0) {
        lines.push("  Expected Benefits");
        lines.push(`  ${"─".repeat(52)}`);
        for (const b of artifact.expectedBenefits) {
            lines.push(`  + ${truncate(b, 64)}`);
        }
        lines.push("");
    }
    // Findings
    if (run.findings && run.findings.length > 0) {
        lines.push("  Findings");
        lines.push(`  ${"─".repeat(52)}`);
        for (const f of run.findings) {
            const sevIcon = f.severity === "critical" ? "!!" : f.severity === "major" ? "! " : "· ";
            lines.push(`  ${sevIcon} [${f.severity}] ${truncate(f.description, 52)}`);
        }
        lines.push("");
    }
    // Open questions
    if (run.openQuestions && run.openQuestions.length > 0) {
        lines.push("  Open Questions");
        lines.push(`  ${"─".repeat(52)}`);
        for (const q of run.openQuestions) {
            lines.push(`  ? [${q.owner}] ${truncate(q.question, 52)}`);
        }
        lines.push("");
    }
    // Blocking reason
    if (run.blockReason) {
        lines.push("  Blocked");
        lines.push(`  ${"─".repeat(52)}`);
        wrapText(run.blockReason, 64).forEach((l) => lines.push(`  ${l}`));
        lines.push("");
    }
    // Mutation details
    if (run.mutation) {
        lines.push("  Applied Changes");
        lines.push(`  ${"─".repeat(52)}`);
        lines.push(`  Applied: ${run.mutation.applied ? "yes" : "no"}`);
        if (run.mutation.branchName)
            lines.push(`  Branch:  ${run.mutation.branchName}`);
        if (run.mutation.commitHash)
            lines.push(`  Commit:  ${run.mutation.commitHash.substring(0, 12)}`);
        if (run.mutation.filesChanged.length > 0) {
            for (const f of run.mutation.filesChanged) {
                lines.push(`  · ${f}`);
            }
        }
        lines.push("");
    }
    // Pipeline (compact)
    lines.push("  Pipeline");
    lines.push(`  ${"─".repeat(52)}`);
    for (const stage of run.stages) {
        const si = stageIcon(stage.status);
        const dur = stage.durationMs > 0 ? formatDuration(stage.durationMs) : "—";
        lines.push(`  ${si} ${stage.capabilityId.padEnd(16)} ${stage.status.padEnd(8)} ${dur}`);
    }
    lines.push("");
    // Run reference
    lines.push(`  Run: ${run.workflowId}`);
    lines.push("");
    return lines.join("\n");
}
function categoryLabel(cat) {
    switch (cat) {
        case "extraction": return "Service/Module Extraction";
        case "decomposition": return "Component Decomposition";
        case "consolidation": return "Logic Consolidation";
        case "simplification": return "Code Simplification";
        case "architecture": return "Architectural Restructuring";
        default: return "Structural Improvement";
    }
}
function riskIcon(level) {
    switch (level) {
        case "high": return "🔴";
        case "medium": return "🟡";
        case "low": return "🟢";
        default: return "⚪";
    }
}
function stageIcon(status) {
    switch (status) {
        case "passed": return "✓";
        case "failed": return "✗";
        case "blocked": return "⊘";
        case "skipped": return "·";
        default: return "?";
    }
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    if (ms < 60_000)
        return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}
function truncate(s, max) {
    return s.length > max ? s.substring(0, max - 3) + "..." : s;
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
//# sourceMappingURL=refactorRenderer.js.map