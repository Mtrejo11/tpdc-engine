/**
 * Renderer for `tpdc discovery` output.
 *
 * Emphasizes framing, questions, options, and readiness —
 * not execution details.
 */

import { DiscoveryArtifact } from "../handlers/discoveryArtifact";
import { RunSummary } from "../../storage/runs";

export function renderDiscoveryResult(
  artifact: DiscoveryArtifact,
  run: RunSummary,
): string {
  const lines: string[] = [];

  const readinessIcon = artifact.readiness === "ready_for_execution" ? "🟢"
    : artifact.readiness === "needs_input" ? "🟡"
    : "🔴";

  const readinessLabel = artifact.readiness === "ready_for_execution" ? "READY"
    : artifact.readiness === "needs_input" ? "NEEDS INPUT"
    : "NOT READY";

  lines.push("");
  lines.push(`  ${readinessIcon} DISCOVERY — ${readinessLabel}`);
  lines.push(`  ${"═".repeat(52)}`);
  lines.push("");

  // Idea
  lines.push("  Idea");
  lines.push(`  ${"─".repeat(52)}`);
  wrapText(artifact.idea, 64).forEach((l) => lines.push(`  ${l}`));
  lines.push("");

  // Problem Framing
  if (artifact.problemFraming && artifact.problemFraming !== artifact.idea) {
    lines.push("  Problem Framing");
    lines.push(`  ${"─".repeat(52)}`);
    wrapText(artifact.problemFraming, 64).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
  }

  // Affected Areas
  if (artifact.affectedAreas.length > 0) {
    lines.push("  Affected Areas");
    lines.push(`  ${"─".repeat(52)}`);
    for (const area of artifact.affectedAreas) {
      lines.push(`  ▸ ${truncate(area, 64)}`);
    }
    lines.push("");
  }

  // Impact Areas
  if (artifact.impactAreas.length > 0) {
    lines.push("  Impact Areas");
    lines.push(`  ${"─".repeat(52)}`);
    for (const area of artifact.impactAreas) {
      lines.push(`  ◆ ${area}`);
    }
    lines.push("");
  }

  // Constraints
  if (artifact.constraints.length > 0) {
    lines.push("  Constraints");
    lines.push(`  ${"─".repeat(52)}`);
    for (const c of artifact.constraints) {
      lines.push(`  · ${truncate(c, 64)}`);
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

  // Open Questions — split by criticality
  if (artifact.criticalQuestions.length > 0) {
    lines.push("  Critical Questions (blocking)");
    lines.push(`  ${"─".repeat(52)}`);
    for (const q of artifact.criticalQuestions) {
      lines.push(`  ✗ [${q.owner}] ${truncate(q.question, 52)}`);
    }
    lines.push("");
  }

  if (artifact.informationalQuestions.length > 0) {
    lines.push("  Informational Questions");
    lines.push(`  ${"─".repeat(52)}`);
    for (const q of artifact.informationalQuestions) {
      lines.push(`  ? [${q.owner}] ${truncate(q.question, 52)}`);
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

  // Tradeoffs
  if (artifact.tradeoffs.length > 0) {
    lines.push("  Tradeoffs");
    lines.push(`  ${"─".repeat(52)}`);
    for (const t of artifact.tradeoffs) {
      lines.push(`  ┌ ${truncate(t.option, 64)}`);
      for (const adv of t.advantages) {
        lines.push(`  │ + ${truncate(adv, 60)}`);
      }
      for (const dis of t.disadvantages) {
        lines.push(`  │ - ${truncate(dis, 60)}`);
      }
      lines.push(`  └`);
    }
    lines.push("");
  }

  // Recommendation
  if (artifact.recommendation) {
    lines.push("  Recommendation");
    lines.push(`  ${"─".repeat(52)}`);
    wrapText(artifact.recommendation, 64).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
  }

  // Decision Drivers
  if (artifact.decisionDrivers.length > 0) {
    lines.push("  Decision Drivers");
    lines.push(`  ${"─".repeat(52)}`);
    for (const d of artifact.decisionDrivers) {
      lines.push(`  → ${truncate(d, 64)}`);
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
  lines.push(`  Duration: ${formatDuration(run.totalDurationMs)}`);
  if (run.score !== undefined) {
    lines.push(`  Score: ${run.score}/100`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Render a discovery-oriented summary.md (not the generic workflow one).
 */
export function renderDiscoveryMarkdown(
  artifact: DiscoveryArtifact,
  run: RunSummary,
): string {
  const lines: string[] = [];

  const readinessEmoji = artifact.readiness === "ready_for_execution" ? "🟢"
    : artifact.readiness === "needs_input" ? "🟡"
    : "🔴";

  lines.push(`# ${readinessEmoji} Discovery: ${artifact.title}`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|-------|-------|");
  lines.push(`| **Workflow ID** | \`${run.workflowId}\` |`);
  lines.push(`| **Readiness** | ${artifact.readiness} |`);
  if (run.score !== undefined) lines.push(`| **Score** | ${run.score}/100 |`);
  lines.push(`| **Duration** | ${formatDuration(run.totalDurationMs)} |`);
  lines.push(`| **Timestamp** | ${run.timestamp} |`);
  lines.push("");

  lines.push("## Idea");
  lines.push("");
  lines.push(`> ${artifact.idea}`);
  lines.push("");

  if (artifact.problemFraming && artifact.problemFraming !== artifact.idea) {
    lines.push("## Problem Framing");
    lines.push("");
    lines.push(artifact.problemFraming);
    lines.push("");
  }

  if (artifact.affectedAreas.length > 0) {
    lines.push("## Affected Areas");
    lines.push("");
    for (const a of artifact.affectedAreas) lines.push(`- ${a}`);
    lines.push("");
  }

  if (artifact.impactAreas.length > 0) {
    lines.push("## Impact Areas");
    lines.push("");
    for (const a of artifact.impactAreas) lines.push(`- ${a}`);
    lines.push("");
  }

  if (artifact.constraints.length > 0) {
    lines.push("## Constraints");
    lines.push("");
    for (const c of artifact.constraints) lines.push(`- ${c}`);
    lines.push("");
  }

  if (artifact.assumptions.length > 0) {
    lines.push("## Assumptions");
    lines.push("");
    for (const a of artifact.assumptions) lines.push(`- ${a}`);
    lines.push("");
  }

  // Questions — split by classification
  if (artifact.criticalQuestions.length > 0) {
    lines.push("## Critical Questions (Blocking)");
    lines.push("");
    for (const q of artifact.criticalQuestions) {
      lines.push(`- **[${q.owner}]** ${q.question}`);
    }
    lines.push("");
  }

  if (artifact.informationalQuestions.length > 0) {
    lines.push("## Informational Questions");
    lines.push("");
    for (const q of artifact.informationalQuestions) {
      lines.push(`- **[${q.owner}]** ${q.question}`);
    }
    lines.push("");
  }

  if (artifact.risks.length > 0) {
    lines.push("## Risks");
    lines.push("");
    for (const r of artifact.risks) {
      lines.push(`- **Risk:** ${r.risk}`);
      if (r.mitigation) lines.push(`  - *Mitigation:* ${r.mitigation}`);
    }
    lines.push("");
  }

  if (artifact.tradeoffs.length > 0) {
    lines.push("## Tradeoffs");
    lines.push("");
    for (const t of artifact.tradeoffs) {
      lines.push(`### ${t.option}`);
      if (t.advantages.length > 0) {
        lines.push("");
        lines.push("**Advantages:**");
        for (const a of t.advantages) lines.push(`- ${a}`);
      }
      if (t.disadvantages.length > 0) {
        lines.push("");
        lines.push("**Disadvantages:**");
        for (const d of t.disadvantages) lines.push(`- ${d}`);
      }
      lines.push("");
    }
  }

  if (artifact.recommendation) {
    lines.push("## Recommendation");
    lines.push("");
    lines.push(artifact.recommendation);
    lines.push("");
  }

  if (artifact.decisionDrivers.length > 0) {
    lines.push("## Decision Drivers");
    lines.push("");
    for (const d of artifact.decisionDrivers) lines.push(`- ${d}`);
    lines.push("");
  }

  lines.push("## Readiness");
  lines.push("");
  lines.push(`${readinessEmoji} **${artifact.readiness}** — ${artifact.readinessReason}`);
  lines.push("");

  lines.push("## Suggested Next Step");
  lines.push("");
  lines.push("```");
  lines.push(artifact.suggestedNextCommand);
  lines.push("```");
  lines.push("");

  lines.push("---");
  lines.push(`*Generated by tpdc-engine discovery at ${run.timestamp}*`);
  lines.push("");

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + "..." : s;
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const words = text.split(" ");
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current += (current ? " " : "") + word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
