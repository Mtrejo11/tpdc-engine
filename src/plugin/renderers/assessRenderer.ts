/**
 * Renderer for `tpdc assess` output.
 *
 * Emphasizes:
 * - scope analyzed
 * - findings with risk classification
 * - supporting evidence
 * - recommended actions
 */

import { RunSummary } from "../../storage/runs";
import { AssessmentContext } from "../handlers/assessNormalizer";
import { loadArtifact } from "../../storage/local";

type RiskLevel = "critical" | "high" | "medium" | "low";

interface ClassifiedFinding {
  risk: RiskLevel;
  title: string;
  evidence: string;
  action: string;
}

export function renderAssessResult(run: RunSummary, ctx: AssessmentContext): string {
  const lines: string[] = [];

  const categoryLabel = ctx.category === "general"
    ? "ANALYSIS"
    : `${ctx.category.toUpperCase()} ASSESSMENT`;

  const verdictIcon = run.finalVerdict === "pass" ? "✅"
    : run.finalVerdict === "fail" ? "❌"
    : run.finalVerdict === "blocked" ? "⚠️"
    : "❔";

  lines.push("");
  lines.push(`  ${verdictIcon} ${categoryLabel} — ${run.finalVerdict.toUpperCase()}`);
  lines.push(`  ${"═".repeat(52)}`);
  lines.push("");

  // Request
  lines.push(`  Request: ${truncate(ctx.rawInput, 65)}`);
  lines.push(`  Category: ${ctx.category}`);
  if (run.score !== undefined) {
    lines.push(`  Score: ${run.score}/100`);
  }
  lines.push(`  Duration: ${formatDuration(run.totalDurationMs)}`);
  lines.push("");

  // Scope — from design artifact
  const design = loadArtifact(run.workflowId, "design") as Record<string, unknown> | null;
  if (design?.scope) {
    const scope = design.scope as { inScope?: string[]; outOfScope?: string[] };
    lines.push("  Scope");
    lines.push(`  ${"─".repeat(52)}`);
    if (scope.inScope) {
      for (const item of scope.inScope) {
        lines.push(`  ▸ ${truncate(item, 64)}`);
      }
    }
    if (scope.outOfScope && scope.outOfScope.length > 0) {
      lines.push("");
      lines.push("  Out of scope:");
      for (const item of scope.outOfScope) {
        lines.push(`    · ${truncate(item, 60)}`);
      }
    }
    lines.push("");
  }

  // Collect and classify all findings
  const classified = classifyFindings(run, design);

  if (classified.length > 0) {
    lines.push("  Findings");
    lines.push(`  ${"─".repeat(52)}`);

    // Group by risk level
    const groups: Record<RiskLevel, ClassifiedFinding[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };
    for (const f of classified) {
      groups[f.risk].push(f);
    }

    for (const level of ["critical", "high", "medium", "low"] as RiskLevel[]) {
      const items = groups[level];
      if (items.length === 0) continue;

      const levelIcon = riskIcon(level);
      lines.push("");
      lines.push(`  ${levelIcon} ${level.toUpperCase()} (${items.length})`);

      for (const f of items) {
        lines.push(`  ┌ ${f.title}`);
        if (f.evidence) {
          lines.push(`  │ Evidence: ${truncate(f.evidence, 56)}`);
        }
        if (f.action) {
          lines.push(`  └ Action: ${truncate(f.action, 58)}`);
        }
        lines.push("");
      }
    }
  } else {
    lines.push("  Findings");
    lines.push(`  ${"─".repeat(52)}`);
    lines.push("  No findings identified.");
    lines.push("");
  }

  // Overall risk level
  const overallRisk = classified.length === 0 ? "low"
    : classified.some((f) => f.risk === "critical") ? "critical"
    : classified.some((f) => f.risk === "high") ? "high"
    : classified.some((f) => f.risk === "medium") ? "medium"
    : "low";

  lines.push("  Risk Level");
  lines.push(`  ${"─".repeat(52)}`);
  lines.push(`  ${riskIcon(overallRisk)} Overall: ${overallRisk.toUpperCase()}`);
  lines.push(`  ${classified.length} finding(s): ${countByRisk(classified)}`);
  lines.push("");

  // Context / root-cause analysis from design
  if (design?.context) {
    const context = design.context as string | string[];
    lines.push("  Evidence / Context");
    lines.push(`  ${"─".repeat(52)}`);
    const contextItems = Array.isArray(context) ? context : [context];
    for (const item of contextItems) {
      wrapText(item, 64).forEach((l) => lines.push(`  ${l}`));
      if (contextItems.length > 1) lines.push("");
    }
    lines.push("");
  }

  // Recommended actions — from design decision + risks mitigations
  const actions = extractActions(design, run);
  if (actions.length > 0) {
    lines.push("  Recommended Actions");
    lines.push(`  ${"─".repeat(52)}`);
    for (let i = 0; i < actions.length; i++) {
      lines.push(`  ${i + 1}. ${truncate(actions[i], 62)}`);
    }
    lines.push("");
  }

  // Blocking reason (if workflow blocked)
  if (run.blockReason) {
    lines.push("  Blocked");
    lines.push(`  ${"─".repeat(52)}`);
    wrapText(run.blockReason, 64).forEach((l) => lines.push(`  ${l}`));
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

/**
 * Classify findings from validate findings + design risks into
 * a unified risk-leveled list.
 */
function classifyFindings(
  run: RunSummary,
  design: Record<string, unknown> | null,
): ClassifiedFinding[] {
  const result: ClassifiedFinding[] = [];

  // From validate findings
  if (run.findings) {
    for (const f of run.findings) {
      result.push({
        risk: severityToRisk(f.severity),
        title: `${f.category}: ${f.description}`,
        evidence: "",
        action: "",
      });
    }
  }

  // From design risks
  if (design?.risks) {
    const risks = design.risks as Array<{
      risk: string;
      trigger?: string;
      mitigation?: string;
      detection?: string;
    }>;
    for (const r of risks) {
      // Classify based on keywords in the risk description
      const risk = classifyRiskLevel(r.risk);
      result.push({
        risk,
        title: r.risk,
        evidence: r.trigger || r.detection || "",
        action: r.mitigation || "",
      });
    }
  }

  // Sort: critical first, then high, medium, low
  const order: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  result.sort((a, b) => order[a.risk] - order[b.risk]);

  return result;
}

function severityToRisk(severity: string): RiskLevel {
  switch (severity) {
    case "critical": return "critical";
    case "major": return "high";
    case "minor": return "low";
    default: return "medium";
  }
}

function classifyRiskLevel(description: string): RiskLevel {
  const lower = description.toLowerCase();
  if (/\b(critical|exploit|inject|leak|breach|unauthorized|privilege.?escalat)\b/.test(lower)) return "critical";
  if (/\b(security|vulnerab|expos|bypass|missing.?auth|cross.?tenant|crash|data.?loss|corrupt)\b/.test(lower)) return "high";
  if (/\b(unknown|unclear|missing|incorrect|inconsisten|confus|degrad|delay)\b/.test(lower)) return "medium";
  return "low";
}

function extractActions(
  design: Record<string, unknown> | null,
  run: RunSummary,
): string[] {
  const actions: string[] = [];

  // From design decision
  if (design?.decision) {
    const decision = design.decision as string;
    // Split on "because" to get the action part
    const actionPart = decision.split(" — because")[0].split(" — ")[0];
    if (actionPart.length > 20) {
      actions.push(actionPart);
    }
  }

  // From design risks mitigations (deduplicated)
  if (design?.risks) {
    const risks = design.risks as Array<{ mitigation?: string }>;
    for (const r of risks) {
      if (r.mitigation && !actions.some((a) => a === r.mitigation)) {
        actions.push(r.mitigation);
      }
    }
  }

  // From open questions as actions
  if (run.openQuestions) {
    for (const q of run.openQuestions) {
      actions.push(`Resolve: ${q.question}`);
    }
  }

  return actions;
}

function riskIcon(level: RiskLevel): string {
  switch (level) {
    case "critical": return "🔴";
    case "high": return "🟠";
    case "medium": return "🟡";
    case "low": return "🟢";
  }
}

function countByRisk(findings: ClassifiedFinding[]): string {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.risk] = (counts[f.risk] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
}

function stageIcon(status: string): string {
  switch (status) {
    case "passed": return "✓";
    case "failed": return "✗";
    case "blocked": return "⊘";
    case "skipped": return "·";
    default: return "?";
  }
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
