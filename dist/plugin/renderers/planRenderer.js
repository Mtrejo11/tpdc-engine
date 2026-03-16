"use strict";
/**
 * Renderer for `tpdc plan` output.
 *
 * Emphasizes implementation phases, dependencies,
 * affected files, and readiness.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPlanResult = renderPlanResult;
exports.renderPlanMarkdown = renderPlanMarkdown;
function renderPlanResult(run, artifact) {
    const lines = [];
    const readinessIcon = artifact.readiness === "ready_to_execute" ? "🟢"
        : artifact.readiness === "needs_input" ? "🟡"
            : "🔴";
    const readinessLabel = artifact.readiness === "ready_to_execute" ? "READY"
        : artifact.readiness === "needs_input" ? "NEEDS INPUT"
            : "BLOCKED";
    lines.push("");
    lines.push(`  ${readinessIcon} PLAN — ${readinessLabel}`);
    lines.push(`  ${"═".repeat(52)}`);
    lines.push("");
    // Plan Summary
    lines.push("  Plan Summary");
    lines.push(`  ${"─".repeat(52)}`);
    lines.push(`  ${truncate(artifact.title, 66)}`);
    if (run.score !== undefined)
        lines.push(`  Score: ${run.score}/100`);
    lines.push(`  Duration: ${formatDuration(run.totalDurationMs)}`);
    lines.push("");
    // Objective
    if (artifact.objective && artifact.objective !== artifact.request) {
        lines.push("  Objective");
        lines.push(`  ${"─".repeat(52)}`);
        wrapText(artifact.objective, 64).forEach((l) => lines.push(`  ${l}`));
        lines.push("");
    }
    // Scope
    if (artifact.scope.length > 0) {
        lines.push("  Scope");
        lines.push(`  ${"─".repeat(52)}`);
        for (const s of artifact.scope) {
            lines.push(`  ▸ ${truncate(s, 64)}`);
        }
        lines.push("");
    }
    // Affected Areas
    if (artifact.affectedAreas.length > 0 && artifact.affectedAreas !== artifact.scope) {
        lines.push("  Affected Areas");
        lines.push(`  ${"─".repeat(52)}`);
        for (const a of artifact.affectedAreas) {
            lines.push(`  ▸ ${truncate(a, 64)}`);
        }
        lines.push("");
    }
    // Likely Files
    if (artifact.likelyFiles.length > 0) {
        lines.push(`  Likely Files (${artifact.likelyFiles.length})`);
        lines.push(`  ${"─".repeat(52)}`);
        for (const f of artifact.likelyFiles) {
            lines.push(`  · ${f}`);
        }
        lines.push("");
    }
    // Assumptions
    if (artifact.assumptions.length > 0) {
        lines.push("  Assumptions");
        lines.push(`  ${"─".repeat(52)}`);
        for (const a of artifact.assumptions) {
            lines.push(`  ~ ${truncate(a, 64)}`);
        }
        lines.push("");
    }
    // Risks
    if (artifact.risks.length > 0) {
        lines.push("  Risks");
        lines.push(`  ${"─".repeat(52)}`);
        for (const r of artifact.risks) {
            lines.push(`  ⚠ ${truncate(r.risk, 64)}`);
            if (r.mitigation) {
                lines.push(`    → ${truncate(r.mitigation, 60)}`);
            }
        }
        lines.push("");
    }
    // Phases
    if (artifact.phases.length > 0) {
        lines.push(`  Phases (${artifact.phases.length})`);
        lines.push(`  ${"─".repeat(52)}`);
        for (const p of artifact.phases) {
            const depLabel = p.dependsOn.length > 0 ? ` [after step ${p.dependsOn.join(", ")}]` : "";
            lines.push(`  ${p.stepNumber}. ${truncate(p.title, 58)}${depLabel}`);
            if (p.goal) {
                wrapText(p.goal, 60).forEach((l) => lines.push(`     ${l}`));
            }
            if (p.files.length > 0) {
                for (const f of p.files) {
                    lines.push(`     · ${f}`);
                }
            }
        }
        lines.push("");
    }
    // Dependencies
    if (artifact.dependencies.length > 0) {
        lines.push("  Dependencies");
        lines.push(`  ${"─".repeat(52)}`);
        for (const d of artifact.dependencies) {
            lines.push(`  · ${truncate(d, 64)}`);
        }
        lines.push("");
    }
    // Validation Approach
    if (artifact.validationApproach.length > 0) {
        lines.push("  Validation Approach");
        lines.push(`  ${"─".repeat(52)}`);
        for (const v of artifact.validationApproach) {
            lines.push(`  ☐ ${truncate(v, 64)}`);
        }
        lines.push("");
    }
    // Open Questions
    if (artifact.openQuestions.length > 0) {
        lines.push("  Open Questions");
        lines.push(`  ${"─".repeat(52)}`);
        for (const q of artifact.openQuestions) {
            lines.push(`  ? [${q.owner}] ${truncate(q.question, 52)}`);
        }
        lines.push("");
    }
    // Readiness
    lines.push("  Readiness");
    lines.push(`  ${"─".repeat(52)}`);
    lines.push(`  ${readinessIcon} ${readinessLabel}`);
    wrapText(artifact.readinessReason, 64).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
    // Suggested Next Step
    lines.push("  Suggested Next Step");
    lines.push(`  ${"─".repeat(52)}`);
    wrapText(artifact.suggestedNextCommand, 64).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
    // Metadata
    lines.push(`  ${"─".repeat(52)}`);
    lines.push(`  Run: ${run.workflowId}`);
    lines.push("");
    return lines.join("\n");
}
/**
 * Render a plan-oriented summary.md.
 */
function renderPlanMarkdown(artifact, run) {
    const lines = [];
    const emoji = artifact.readiness === "ready_to_execute" ? "🟢"
        : artifact.readiness === "needs_input" ? "🟡"
            : "🔴";
    lines.push(`# ${emoji} Plan: ${artifact.title}`);
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|-------|-------|");
    lines.push(`| **Workflow ID** | \`${run.workflowId}\` |`);
    lines.push(`| **Readiness** | ${artifact.readiness} |`);
    if (run.score !== undefined)
        lines.push(`| **Score** | ${run.score}/100 |`);
    lines.push(`| **Duration** | ${formatDuration(run.totalDurationMs)} |`);
    lines.push(`| **Timestamp** | ${run.timestamp} |`);
    lines.push("");
    lines.push("## Objective");
    lines.push("");
    lines.push(artifact.objective);
    lines.push("");
    if (artifact.scope.length > 0) {
        lines.push("## Scope");
        lines.push("");
        for (const s of artifact.scope)
            lines.push(`- ${s}`);
        lines.push("");
    }
    if (artifact.likelyFiles.length > 0) {
        lines.push("## Likely Files");
        lines.push("");
        for (const f of artifact.likelyFiles)
            lines.push(`- \`${f}\``);
        lines.push("");
    }
    if (artifact.assumptions.length > 0) {
        lines.push("## Assumptions");
        lines.push("");
        for (const a of artifact.assumptions)
            lines.push(`- ${a}`);
        lines.push("");
    }
    if (artifact.risks.length > 0) {
        lines.push("## Risks");
        lines.push("");
        for (const r of artifact.risks) {
            lines.push(`- **Risk:** ${r.risk}`);
            if (r.mitigation)
                lines.push(`  - *Mitigation:* ${r.mitigation}`);
        }
        lines.push("");
    }
    if (artifact.phases.length > 0) {
        lines.push("## Implementation Phases");
        lines.push("");
        for (const p of artifact.phases) {
            const dep = p.dependsOn.length > 0 ? ` *(depends on step ${p.dependsOn.join(", ")})*` : "";
            lines.push(`### Phase ${p.stepNumber}: ${p.title}${dep}`);
            lines.push("");
            if (p.goal)
                lines.push(p.goal);
            if (p.files.length > 0) {
                lines.push("");
                lines.push("**Files:**");
                for (const f of p.files)
                    lines.push(`- \`${f}\``);
            }
            lines.push("");
        }
    }
    if (artifact.dependencies.length > 0) {
        lines.push("## Dependencies");
        lines.push("");
        for (const d of artifact.dependencies)
            lines.push(`- ${d}`);
        lines.push("");
    }
    if (artifact.validationApproach.length > 0) {
        lines.push("## Validation Approach");
        lines.push("");
        for (const v of artifact.validationApproach)
            lines.push(`- [ ] ${v}`);
        lines.push("");
    }
    if (artifact.openQuestions.length > 0) {
        lines.push("## Open Questions");
        lines.push("");
        for (const q of artifact.openQuestions) {
            lines.push(`- **[${q.owner}]** ${q.question}`);
        }
        lines.push("");
    }
    lines.push("## Readiness");
    lines.push("");
    lines.push(`${emoji} **${artifact.readiness}** — ${artifact.readinessReason}`);
    lines.push("");
    lines.push("## Suggested Next Step");
    lines.push("");
    lines.push("```");
    lines.push(artifact.suggestedNextCommand);
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push(`*Generated by tpdc-engine plan at ${run.timestamp}*`);
    lines.push("");
    return lines.join("\n");
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
//# sourceMappingURL=planRenderer.js.map