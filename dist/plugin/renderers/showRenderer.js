"use strict";
/**
 * Renderer for `tpdc show <runId>`.
 *
 * Displays a polished overview of a completed workflow run.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderShow = renderShow;
function renderShow(run) {
    const lines = [];
    const v = run.finalVerdict.toUpperCase();
    const icon = verdictIcon(run.finalVerdict);
    lines.push("");
    lines.push(`  ${icon} ${run.workflowId}`);
    lines.push(`  ${"─".repeat(50)}`);
    lines.push("");
    // Request
    if (run.originalRequest) {
        lines.push(`  Request:  ${truncate(run.originalRequest, 70)}`);
    }
    lines.push(`  Mode:     ${run.executionMode}`);
    lines.push(`  Verdict:  ${v}${run.score !== undefined ? ` (${run.score}/100)` : ""}`);
    lines.push(`  Duration: ${formatDuration(run.totalDurationMs)}`);
    lines.push(`  Adapter:  ${run.adapter.modelId} (${run.adapter.transport})`);
    lines.push(`  Time:     ${formatTimestamp(run.timestamp)}`);
    lines.push("");
    // Stages
    lines.push("  Stages");
    lines.push(`  ${"─".repeat(50)}`);
    for (const stage of run.stages) {
        const si = stageIcon(stage.status);
        const dur = stage.durationMs > 0 ? formatDuration(stage.durationMs) : "—";
        let line = `  ${si} ${stage.capabilityId.padEnd(16)} ${stage.status.padEnd(8)} ${dur}`;
        if (stage.blockReason && (stage.status === "blocked" || stage.status === "failed")) {
            line += `\n     ${truncate(stage.blockReason, 60)}`;
        }
        lines.push(line);
    }
    lines.push("");
    // Block reason
    if (run.blockReason) {
        lines.push("  Blocking Reason");
        lines.push(`  ${"─".repeat(50)}`);
        lines.push(`  ${run.blockReason}`);
        lines.push("");
    }
    // Findings
    if (run.findings && run.findings.length > 0) {
        lines.push("  Findings");
        lines.push(`  ${"─".repeat(50)}`);
        const grouped = {
            critical: run.findings.filter((f) => f.severity === "critical"),
            major: run.findings.filter((f) => f.severity === "major"),
            minor: run.findings.filter((f) => f.severity === "minor"),
        };
        for (const [sev, items] of Object.entries(grouped)) {
            for (const f of items) {
                const sevIcon = sev === "critical" ? "!!" : sev === "major" ? "! " : "· ";
                lines.push(`  ${sevIcon} [${sev}] ${f.category}: ${truncate(f.description, 55)}`);
            }
        }
        lines.push("");
    }
    // Open questions
    if (run.openQuestions && run.openQuestions.length > 0) {
        lines.push("  Open Questions");
        lines.push(`  ${"─".repeat(50)}`);
        for (const q of run.openQuestions) {
            lines.push(`  ? [${q.owner}] ${truncate(q.question, 55)}`);
        }
        lines.push("");
    }
    // Mutation details (expanded for mutation runs)
    if (run.mutation) {
        const m = run.mutation;
        const isDeclined = m.confirmationSource === "declined" || m.confirmationSource === "none";
        const applyLabel = m.applied ? "APPLIED" : (m.rollbackTriggered || (!isDeclined && m.errors.length > 0)) ? "FAILED" : "NOT APPLIED";
        const applyIcon = m.applied ? "✓" : applyLabel === "FAILED" ? "✗" : "⊘";
        lines.push("  Mutation");
        lines.push(`  ${"─".repeat(50)}`);
        lines.push(`  Status:   ${applyIcon} ${applyLabel}`);
        lines.push(`  Patches:  ${m.patchGenerated ? "generated" : "none"}`);
        lines.push(`  Dry-run:  ${m.dryRunPassed ? "passed" : "failed/skipped"}`);
        lines.push(`  Confirm:  ${m.confirmationSource}`);
        if (m.branchName)
            lines.push(`  Branch:   ${m.branchName}`);
        if (m.commitHash)
            lines.push(`  Commit:   ${m.commitHash.substring(0, 12)}`);
        if (m.filesChanged.length > 0) {
            lines.push(`  Files:    ${m.filesChanged.length}`);
            for (const f of m.filesChanged) {
                lines.push(`    · ${f}`);
            }
        }
        if (m.rollbackTriggered) {
            lines.push(`  Rollback: ⚠ triggered`);
        }
        if (m.errors.length > 0) {
            lines.push(`  Errors:`);
            for (const e of m.errors) {
                lines.push(`    ✗ ${truncate(e, 60)}`);
            }
        }
        lines.push("");
    }
    // Artifact paths
    lines.push("  Artifacts");
    lines.push(`  ${"─".repeat(50)}`);
    for (const p of run.artifactPaths) {
        const basename = p.split("/").pop();
        lines.push(`  · ${basename}`);
    }
    lines.push("");
    // Summary
    lines.push("  Summary");
    lines.push(`  ${"─".repeat(50)}`);
    wrapText(run.summary, 68).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
    return lines.join("\n");
}
function verdictIcon(verdict) {
    switch (verdict) {
        case "pass": return "✅ PASS";
        case "fail": return "❌ FAIL";
        case "blocked": return "⚠️  BLOCKED";
        case "inconclusive": return "❔ INCONCLUSIVE";
        default: return `❔ ${verdict.toUpperCase()}`;
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
function formatTimestamp(ts) {
    try {
        const d = new Date(ts);
        return d.toLocaleString();
    }
    catch {
        return ts;
    }
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
//# sourceMappingURL=showRenderer.js.map