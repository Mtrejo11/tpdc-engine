/**
 * Generates a polished summary.md for a workflow run.
 *
 * Persisted to the run's artifact directory for human consumption.
 * Mutation runs include expanded git/apply/rollback details.
 */

import { RunSummary } from "../../storage/runs";

export function renderSummaryMarkdown(run: RunSummary): string {
  const lines: string[] = [];

  const verdictEmoji = run.finalVerdict === "pass" ? "✅"
    : run.finalVerdict === "fail" ? "❌"
    : run.finalVerdict === "blocked" ? "⚠️"
    : "❔";

  // Header
  lines.push(`# ${verdictEmoji} Workflow Summary`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|-------|-------|");
  lines.push(`| **Workflow ID** | \`${run.workflowId}\` |`);
  lines.push(`| **Mode** | ${run.executionMode} |`);
  lines.push(`| **Verdict** | **${run.finalVerdict.toUpperCase()}** |`);
  if (run.score !== undefined) {
    lines.push(`| **Score** | ${run.score}/100 |`);
  }
  lines.push(`| **Duration** | ${formatDuration(run.totalDurationMs)} |`);
  lines.push(`| **Model** | ${run.adapter.modelId} (${run.adapter.transport}) |`);
  lines.push(`| **Timestamp** | ${run.timestamp} |`);
  if (run.mutation) {
    const m = run.mutation;
    lines.push(`| **Apply Status** | ${m.applied ? "Applied" : m.errors.length > 0 ? "Failed" : "Not applied"} |`);
    if (m.branchName) lines.push(`| **Branch** | \`${m.branchName}\` |`);
    if (m.commitHash) lines.push(`| **Commit** | \`${m.commitHash.substring(0, 12)}\` |`);
  }
  lines.push("");

  // Original request
  if (run.originalRequest) {
    lines.push("## Request");
    lines.push("");
    lines.push(`> ${run.originalRequest}`);
    lines.push("");
  }

  // Stage results
  lines.push("## Pipeline");
  lines.push("");
  lines.push("| Stage | Status | Duration |");
  lines.push("|-------|--------|----------|");
  for (const stage of run.stages) {
    const icon = stage.status === "passed" ? "✅"
      : stage.status === "failed" ? "❌"
      : stage.status === "blocked" ? "⚠️"
      : "⏭️";
    const dur = stage.durationMs > 0 ? formatDuration(stage.durationMs) : "—";
    lines.push(`| ${icon} ${stage.capabilityId} | ${stage.status} | ${dur} |`);
  }
  lines.push("");

  // Blocking reason
  if (run.blockReason) {
    lines.push("## Blocking Reason");
    lines.push("");
    lines.push(`> ${run.blockReason}`);
    lines.push("");
  }

  // Findings
  if (run.findings && run.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    const grouped = {
      critical: run.findings.filter((f) => f.severity === "critical"),
      major: run.findings.filter((f) => f.severity === "major"),
      minor: run.findings.filter((f) => f.severity === "minor"),
    };
    for (const [severity, items] of Object.entries(grouped)) {
      if (items.length > 0) {
        for (const f of items) {
          lines.push(`- **${severity}** (${f.category}): ${f.description}`);
        }
      }
    }
    lines.push("");

    // Surface mutation-specific findings if present
    if (run.mutation) {
      const mutationFindings = run.findings.filter((f) =>
        ["patch_grounding", "apply_integrity", "git_traceability", "workflow_inconsistency", "status_mismatch"].includes(f.category),
      );
      if (mutationFindings.length > 0) {
        lines.push("### Mutation-Specific Findings");
        lines.push("");
        for (const f of mutationFindings) {
          lines.push(`- **${f.severity}** (${f.category}): ${f.description}`);
        }
        lines.push("");
      }
    }
  }

  // Open questions
  if (run.openQuestions && run.openQuestions.length > 0) {
    lines.push("## Open Questions");
    lines.push("");
    for (const q of run.openQuestions) {
      lines.push(`- **[${q.owner}]** ${q.question}`);
    }
    lines.push("");
  }

  // Mutation details (expanded)
  if (run.mutation) {
    const m = run.mutation;
    lines.push("## Mutation Details");
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|-------|-------|");
    lines.push(`| Apply Status | ${m.applied ? "✅ Applied" : m.errors.length > 0 ? "❌ Failed" : "⊘ Not applied"} |`);
    lines.push(`| Patches Generated | ${m.patchGenerated ? "Yes" : "No"} |`);
    lines.push(`| Dry-Run | ${m.dryRunPassed ? "Passed" : "Failed/Skipped"} |`);
    lines.push(`| Confirmation | ${m.confirmationSource} |`);
    if (m.branchName) lines.push(`| Branch | \`${m.branchName}\` |`);
    if (m.commitHash) lines.push(`| Commit | \`${m.commitHash.substring(0, 12)}\` |`);
    if (m.filesChanged.length > 0) {
      lines.push(`| Files Changed | ${m.filesChanged.length} |`);
    }
    if (m.rollbackTriggered) {
      lines.push(`| Rollback | ⚠️ Triggered |`);
    }
    lines.push("");

    if (m.filesChanged.length > 0) {
      lines.push("### Changed Files");
      lines.push("");
      for (const f of m.filesChanged) {
        lines.push(`- \`${f}\``);
      }
      lines.push("");
    }

    if (m.errors.length > 0) {
      lines.push("### Mutation Errors");
      lines.push("");
      for (const e of m.errors) {
        lines.push(`- ${e}`);
      }
      lines.push("");
    }

    // Rollback details
    if (m.rollbackTriggered) {
      lines.push("### Rollback");
      lines.push("");
      lines.push("A rollback was triggered after apply failure. The working tree should be restored to its pre-apply state.");
      lines.push("");
    }
  }

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(run.summary);
  lines.push("");

  // Footer
  lines.push("---");
  lines.push(`*Generated by tpdc-engine at ${run.timestamp}*`);
  lines.push("");

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
