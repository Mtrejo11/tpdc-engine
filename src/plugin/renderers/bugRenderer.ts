/**
 * Renderer for `tpdc fix` output.
 *
 * Bug-oriented display that emphasizes:
 * - bug summary and affected surface
 * - missing context and blocking reason
 * - suggested clarified report (when blocked)
 * - root-cause / patch preview (when available)
 * - manual validation checklist
 */

import { RunSummary } from "../../storage/runs";
import { BugContext, suggestClarifiedReport } from "../handlers/bugNormalizer";
import { loadArtifact } from "../../storage/local";

export function renderBugResult(run: RunSummary, bugCtx: BugContext): string {
  const lines: string[] = [];
  const v = run.finalVerdict.toUpperCase();
  const icon = run.finalVerdict === "pass" ? "✅"
    : run.finalVerdict === "fail" ? "❌"
    : run.finalVerdict === "blocked" ? "⚠️"
    : "❔";

  lines.push("");
  lines.push(`  ${icon} BUG FIX — ${v}`);
  lines.push(`  ${"─".repeat(50)}`);
  lines.push("");

  // Bug summary
  lines.push("  Bug Report");
  lines.push(`  ${"─".repeat(50)}`);
  lines.push(`  ${truncate(bugCtx.rawInput, 70)}`);
  lines.push("");

  // Extracted context
  const ext = bugCtx.extracted;
  if (ext.platform || ext.screen) {
    lines.push("  Detected Context");
    lines.push(`  ${"─".repeat(50)}`);
    if (ext.platform)        lines.push(`  Platform:  ${ext.platform}`);
    if (ext.screen)          lines.push(`  Screen:    ${ext.screen}`);
    if (ext.actualBehavior && ext.actualBehavior !== bugCtx.rawInput)
                             lines.push(`  Actual:    ${truncate(ext.actualBehavior, 55)}`);
    if (ext.expectedBehavior) lines.push(`  Expected:  ${truncate(ext.expectedBehavior, 55)}`);
    if (ext.reproContext)    lines.push(`  Repro:     ${truncate(ext.reproContext, 55)}`);
    lines.push("");
  }

  // Missing context
  if (bugCtx.missingFields.length > 0) {
    lines.push("  Missing Context");
    lines.push(`  ${"─".repeat(50)}`);
    for (const field of bugCtx.missingFields) {
      lines.push(`  ? ${field}`);
    }
    lines.push("");
  }

  // Pipeline overview (compact)
  lines.push(`  Pipeline  [${run.executionMode}]  ${formatDuration(run.totalDurationMs)}`);
  lines.push(`  ${"─".repeat(50)}`);
  for (const stage of run.stages) {
    const si = stageIcon(stage.status);
    const dur = stage.durationMs > 0 ? formatDuration(stage.durationMs) : "—";
    lines.push(`  ${si} ${stage.capabilityId.padEnd(16)} ${stage.status.padEnd(8)} ${dur}`);
  }
  lines.push("");

  // Score
  if (run.score !== undefined) {
    lines.push(`  Score: ${run.score}/100`);
    lines.push("");
  }

  // Blocking reason
  if (run.blockReason) {
    lines.push("  Blocking Reason");
    lines.push(`  ${"─".repeat(50)}`);
    wrapText(run.blockReason, 66).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
  }

  // Suggested clarified bug report (when there are missing fields)
  if (bugCtx.missingFields.length > 0) {
    lines.push("  Suggested Clarified Input");
    lines.push(`  ${"─".repeat(50)}`);
    const suggestion = suggestClarifiedReport(bugCtx);
    lines.push(`  "${suggestion}"`);
    lines.push("");
    lines.push("  Tip: rerun with the clarified input for better results:");
    lines.push(`  tpdc fix "${truncate(suggestion, 60)}"`);
    lines.push("");
  }

  // Root-cause / patch preview from design + execute
  const design = loadArtifact(run.workflowId, "design") as Record<string, unknown> | null;
  const execute = loadArtifact(run.workflowId, "execute") as Record<string, unknown> | null;

  if (design?.decision || design?.context) {
    lines.push("  Root-Cause Analysis");
    lines.push(`  ${"─".repeat(50)}`);
    if (design.context) {
      const ctx = design.context as string;
      wrapText(ctx, 66).forEach((l) => lines.push(`  ${l}`));
    }
    if (design.decision) {
      lines.push("");
      lines.push("  Proposed fix:");
      const decision = design.decision as string;
      wrapText(decision, 66).forEach((l) => lines.push(`  ${l}`));
    }
    lines.push("");
  }

  // Touched artifacts / file preview from execute
  if (execute?.touchedArtifacts) {
    const artifacts = execute.touchedArtifacts as Array<{ filePath: string; changeType: string }>;
    if (artifacts.length > 0) {
      lines.push("  Affected Files (predicted)");
      lines.push(`  ${"─".repeat(50)}`);
      for (const a of artifacts) {
        const opIcon = a.changeType === "create" ? "+" : a.changeType === "delete" ? "-" : "~";
        lines.push(`  ${opIcon} ${a.filePath}`);
      }
      lines.push("");
    }
  }

  // Findings
  if (run.findings && run.findings.length > 0) {
    lines.push("  Findings");
    lines.push(`  ${"─".repeat(50)}`);
    for (const f of run.findings) {
      const sevIcon = f.severity === "critical" ? "!!" : f.severity === "major" ? "! " : "· ";
      lines.push(`  ${sevIcon} [${f.severity}] ${truncate(f.description, 55)}`);
    }
    lines.push("");
  }

  // Manual validation checklist from intake acceptance criteria
  const intake = loadArtifact(run.workflowId, "intake") as Record<string, unknown> | null;
  const ac = intake?.acceptance_criteria as string[] | undefined;
  if (ac && ac.length > 0) {
    lines.push("  Validation Checklist");
    lines.push(`  ${"─".repeat(50)}`);
    for (const criterion of ac) {
      lines.push(`  [ ] ${truncate(criterion, 62)}`);
    }
    lines.push("");
  }

  // Workflow ID for cross-reference
  lines.push(`  Run: ${run.workflowId}`);
  lines.push("");

  return lines.join("\n");
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
