/**
 * Renderer for `tpdc diff <runId>`.
 *
 * Shows patch/diff details for mutation runs with:
 * - git metadata (branch, commit)
 * - dry-run outcome per file
 * - color-coded unified diffs
 * - apply result per file
 * - rollback info if present
 */

import { RunSummary } from "../../storage/runs";
import { loadArtifact } from "../../storage/local";

interface PatchEntry {
  stepNumber?: number;
  filePath: string;
  operation: string;
  diff: string;
  justification?: string;
}

export function renderDiff(run: RunSummary): string {
  const lines: string[] = [];

  if (run.executionMode !== "mutation") {
    lines.push("");
    lines.push(`  ${run.workflowId} is a safe-mode run (no patches).`);
    lines.push("  Use 'tpdc show <runId>' to inspect the run.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`  Diff: ${run.workflowId}`);
  lines.push(`  ${"═".repeat(52)}`);
  lines.push("");

  // Git metadata
  if (run.mutation) {
    const m = run.mutation;
    const applyIcon = m.applied ? "✓" : "✗";
    lines.push(`  Apply:  ${applyIcon} ${m.applied ? "APPLIED" : "NOT APPLIED"}`);
    if (m.branchName) lines.push(`  Branch: ${m.branchName}`);
    if (m.commitHash) lines.push(`  Commit: ${m.commitHash.substring(0, 12)}`);
    if (m.rollbackTriggered) lines.push(`  Rollback: ⚠ triggered`);
    lines.push("");
  }

  // Load artifacts
  const execPatch = loadArtifact(run.workflowId, "execute-patch") as Record<string, unknown> | null;
  if (!execPatch) {
    lines.push("  No execute-patch artifact found.");
    lines.push("");
    return lines.join("\n");
  }

  const patches = (execPatch.patches as PatchEntry[]) || [];
  const changeSummary = execPatch.changeSummary as string | undefined;

  if (changeSummary) {
    lines.push("  Change Summary");
    lines.push(`  ${"─".repeat(52)}`);
    wrapText(changeSummary, 64).forEach((l) => lines.push(`  ${l}`));
    lines.push("");
  }

  // Dry-run results
  const dryRun = loadArtifact(run.workflowId, "dry-run") as Record<string, unknown> | null;
  const patchChecks = dryRun?.patchChecks as Array<{
    filePath: string;
    status: string;
    detail?: string;
  }> | undefined;
  const statusMap = new Map(patchChecks?.map((pc) => [pc.filePath, pc]) || []);

  if (dryRun) {
    const safe = dryRun.safe as boolean;
    const applicable = dryRun.applicable as number;
    const conflicts = dryRun.conflicts as number;
    const safeIcon = safe ? "✓" : "✗";
    lines.push("  Dry-Run");
    lines.push(`  ${"─".repeat(52)}`);
    lines.push(`  Safety:     ${safeIcon} ${safe ? "PASSED" : "FAILED"}`);
    lines.push(`  Applicable: ${applicable}/${patches.length}`);
    if (conflicts > 0) lines.push(`  Conflicts:  ${conflicts}`);
    lines.push("");
  }

  // Apply result
  const apply = loadArtifact(run.workflowId, "apply") as Record<string, unknown> | null;
  const fileResults = apply?.fileResults as Array<{ filePath: string; status: string }> | undefined;
  const applyMap = new Map(fileResults?.map((fr) => [fr.filePath, fr.status]) || []);

  // Files overview
  lines.push(`  Files (${patches.length})`);
  lines.push(`  ${"─".repeat(52)}`);
  for (const p of patches) {
    const opIcon = p.operation === "create" ? "+" : p.operation === "delete" ? "-" : "~";
    const check = statusMap.get(p.filePath);
    const applyStatus = applyMap.get(p.filePath);
    let statusStr = "";
    if (check && check.status !== "applicable") {
      statusStr = ` [dry-run: ${check.status}]`;
    }
    if (applyStatus) {
      const icon = applyStatus === "applied" ? "✓" : "✗";
      statusStr += ` [${icon} ${applyStatus}]`;
    }
    lines.push(`  ${opIcon} ${p.filePath}${statusStr}`);
  }
  lines.push("");

  // Per-file diffs
  for (const p of patches) {
    lines.push(`  ${"═".repeat(52)}`);
    const opLabel = p.operation.toUpperCase();
    const check = statusMap.get(p.filePath);
    const applyStatus = applyMap.get(p.filePath);
    let meta = "";
    if (check) meta += ` [dry-run: ${check.status}]`;
    if (applyStatus) meta += ` [apply: ${applyStatus}]`;
    lines.push(`  ${opLabel}: ${p.filePath}${meta}`);

    if (p.justification) {
      lines.push(`  Reason: ${p.justification}`);
    }
    lines.push(`  ${"─".repeat(52)}`);

    // Show diff with color
    const diffLines = p.diff.split("\n");
    const maxLines = 40;
    const preview = diffLines.slice(0, maxLines);

    for (const dl of preview) {
      if (dl.startsWith("+") && !dl.startsWith("+++")) {
        lines.push(`  \x1b[32m${dl}\x1b[0m`);
      } else if (dl.startsWith("-") && !dl.startsWith("---")) {
        lines.push(`  \x1b[31m${dl}\x1b[0m`);
      } else if (dl.startsWith("@@")) {
        lines.push(`  \x1b[36m${dl}\x1b[0m`);
      } else {
        lines.push(`  ${dl}`);
      }
    }

    if (diffLines.length > maxLines) {
      lines.push(`  ... (${diffLines.length - maxLines} more lines)`);
    }
    lines.push("");
  }

  // Apply summary
  if (apply) {
    const status = apply.status as string;
    const rollback = apply.rollback as { triggered: boolean; reason?: string } | undefined;
    const git = apply.git as { branchName?: string; commitHash?: string; filesStaged?: string[] } | undefined;

    lines.push("  Apply Result");
    lines.push(`  ${"─".repeat(52)}`);
    lines.push(`  Status: ${status}`);
    if (fileResults) {
      for (const fr of fileResults) {
        const frIcon = fr.status === "applied" ? "✓" : "✗";
        lines.push(`  ${frIcon} ${fr.filePath} (${fr.status})`);
      }
    }
    if (rollback?.triggered) {
      lines.push(`  ⚠ Rollback triggered${rollback.reason ? `: ${rollback.reason}` : ""}`);
    }
    if (git?.branchName) lines.push(`  Branch: ${git.branchName}`);
    if (git?.commitHash) lines.push(`  Commit: ${git.commitHash.substring(0, 12)}`);
    lines.push("");
  }

  return lines.join("\n");
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
