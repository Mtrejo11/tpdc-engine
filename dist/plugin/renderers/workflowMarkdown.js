"use strict";
/**
 * Markdown renderer for workflow results.
 *
 * Produces a concise, human-friendly summary suitable for
 * product-facing output (chat, dashboard, report).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWorkflowMarkdown = renderWorkflowMarkdown;
function renderWorkflowMarkdown(result) {
    const lines = [];
    // Header
    lines.push(`# Workflow Report`);
    lines.push("");
    lines.push(`**Request:** ${result.request}`);
    lines.push(`**Workflow:** \`${result.workflowId}\``);
    lines.push(`**Duration:** ${formatDuration(result.totalDurationMs)}`);
    lines.push(`**Model:** ${result.adapter.modelId} (${result.adapter.transport})`);
    lines.push("");
    // Stage table
    lines.push("## Pipeline");
    lines.push("");
    lines.push("| Stage | Status | Duration |");
    lines.push("|-------|--------|----------|");
    for (const stage of result.stages) {
        const icon = stageIcon(stage.status);
        const dur = stage.durationMs > 0 ? formatDuration(stage.durationMs) : "—";
        lines.push(`| ${icon} ${stage.capabilityId} | ${stage.status} | ${dur} |`);
    }
    lines.push("");
    // Verdict + score
    lines.push("## Verdict");
    lines.push("");
    const verdictLine = `**${result.finalVerdict.toUpperCase()}**`;
    if (result.score !== undefined) {
        lines.push(`${verdictLine} — Score: **${result.score}/100**`);
    }
    else {
        lines.push(verdictLine);
    }
    lines.push("");
    // Block reason (from decompose)
    if (result.blockReason) {
        lines.push("## Blocking Reason");
        lines.push("");
        lines.push(`> ${result.blockReason}`);
        lines.push("");
    }
    // Open questions
    if (result.openQuestions && result.openQuestions.length > 0) {
        lines.push("## Open Questions");
        lines.push("");
        for (const q of result.openQuestions) {
            lines.push(`- **[${q.owner}]** ${q.question}`);
        }
        lines.push("");
    }
    // Findings
    if (result.findings && result.findings.length > 0) {
        const critical = result.findings.filter((f) => f.severity === "critical");
        const major = result.findings.filter((f) => f.severity === "major");
        const minor = result.findings.filter((f) => f.severity === "minor");
        lines.push("## Findings");
        lines.push("");
        for (const group of [
            { label: "Critical", items: critical },
            { label: "Major", items: major },
            { label: "Minor", items: minor },
        ]) {
            if (group.items.length > 0) {
                for (const f of group.items) {
                    lines.push(`- **${group.label}** (${f.category}): ${f.description}`);
                }
            }
        }
        lines.push("");
    }
    // Summary
    lines.push("## Summary");
    lines.push("");
    lines.push(result.summary);
    lines.push("");
    return lines.join("\n");
}
function stageIcon(status) {
    switch (status) {
        case "passed": return "\u2705";
        case "failed": return "\u274C";
        case "blocked": return "\u26A0\uFE0F";
        case "skipped": return "\u23ED\uFE0F";
        default: return "\u2753";
    }
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
//# sourceMappingURL=workflowMarkdown.js.map