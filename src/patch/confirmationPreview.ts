/**
 * Interactive confirmation with diff preview before apply.
 *
 * Renders a clear, scannable mutation preview and optionally prompts
 * the user to confirm before proceeding.
 */

import * as readline from "readline";
import { PatchInput, DryRunResult } from "./dryRun";
import { buildBranchName } from "./gitIntegration";

// ── Types ────────────────────────────────────────────────────────────

export interface PreviewData {
  runId: string;
  repoRoot: string;
  patches: PatchInput[];
  dryRunResult: DryRunResult;
  planTitle?: string;
}

export interface ConfirmationResult {
  previewShown: boolean;
  confirmed: boolean;
  /** "interactive" (stdin prompt), "flag" (--confirm-apply), or "declined" */
  source: "interactive" | "flag" | "declined";
}

// ── Preview renderer ─────────────────────────────────────────────────

const MAX_DIFF_LINES = 12;

function operationIcon(op: string): string {
  switch (op) {
    case "create": return "+";
    case "modify": return "~";
    case "delete": return "-";
    default: return "?";
  }
}

function operationLabel(op: string): string {
  switch (op) {
    case "create": return "CREATE";
    case "modify": return "MODIFY";
    case "delete": return "DELETE";
    default: return op.toUpperCase();
  }
}

function diffPreview(diff: string): string[] {
  const lines = diff.split("\n");
  const contentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("@@")) {
      contentLines.push(`\x1b[36m${line}\x1b[0m`);
    } else if (line.startsWith("+")) {
      contentLines.push(`\x1b[32m${line}\x1b[0m`);
    } else if (line.startsWith("-")) {
      contentLines.push(`\x1b[31m${line}\x1b[0m`);
    } else {
      contentLines.push(line);
    }
  }

  if (contentLines.length <= MAX_DIFF_LINES) {
    return contentLines;
  }

  const half = Math.floor(MAX_DIFF_LINES / 2);
  const head = contentLines.slice(0, half);
  const tail = contentLines.slice(-half);
  const omitted = contentLines.length - MAX_DIFF_LINES;
  return [...head, `  \x1b[2m... (${omitted} more lines)\x1b[0m`, ...tail];
}

export function renderPreview(data: PreviewData): string {
  const { runId, repoRoot, patches, dryRunResult, planTitle } = data;
  const branchName = buildBranchName(runId);
  const lines: string[] = [];

  const safeIcon = dryRunResult.safe ? "✓" : "✗";
  const safeColor = dryRunResult.safe ? "\x1b[32m" : "\x1b[31m";

  lines.push("");
  lines.push("  ╔══════════════════════════════════════════╗");
  lines.push("  ║          MUTATION PREVIEW                ║");
  lines.push("  ╚══════════════════════════════════════════╝");
  lines.push("");

  // Overview
  lines.push("  Overview");
  lines.push(`  ${"─".repeat(50)}`);
  lines.push(`  Mode:       mutation`);
  if (planTitle) lines.push(`  Plan:       ${planTitle}`);
  lines.push(`  Repo:       ${repoRoot}`);
  lines.push(`  Branch:     ${branchName}`);
  lines.push(`  Patches:    ${patches.length}`);
  lines.push(`  Applicable: ${dryRunResult.applicable}/${patches.length}`);
  if (dryRunResult.conflicts > 0) {
    lines.push(`  Conflicts:  \x1b[31m${dryRunResult.conflicts}\x1b[0m`);
  }
  lines.push(`  Safety:     ${safeColor}${safeIcon} ${dryRunResult.safe ? "PASSED" : "FAILED"}\x1b[0m`);
  lines.push("");

  // Files overview
  lines.push(`  Files (${patches.length})`);
  lines.push(`  ${"─".repeat(50)}`);
  for (const patch of patches) {
    const check = dryRunResult.patchChecks.find((c) => c.filePath === patch.filePath);
    const status = check?.status || "unknown";
    const statusColor = status === "applicable" ? "\x1b[32m" : "\x1b[31m";
    const statusLabel = status === "applicable" ? "" : ` ${statusColor}[${status}]\x1b[0m`;
    lines.push(`  ${operationIcon(patch.operation)} ${operationLabel(patch.operation).padEnd(7)} ${patch.filePath}${statusLabel}`);
  }
  lines.push("");

  // Per-file diff previews
  lines.push("  Diff Preview");
  lines.push(`  ${"─".repeat(50)}`);
  for (const patch of patches) {
    const check = dryRunResult.patchChecks.find((c) => c.filePath === patch.filePath);
    const status = check?.status || "unknown";
    const statusLabel = status !== "applicable" ? ` [${status}]` : "";
    lines.push(`  ${operationLabel(patch.operation)}: ${patch.filePath}${statusLabel}`);

    const preview = diffPreview(patch.diff);
    for (const line of preview) {
      lines.push(`    ${line}`);
    }
    lines.push("");
  }

  // Safety violations
  if (dryRunResult.safetyViolations.length > 0) {
    lines.push("  Safety Violations");
    lines.push(`  ${"─".repeat(50)}`);
    for (const v of dryRunResult.safetyViolations) {
      lines.push(`  ✗ ${v.filePath}: ${v.detail}`);
    }
    lines.push("");
  }

  // What will happen
  lines.push(`  ${"─".repeat(50)}`);
  if (dryRunResult.safe && dryRunResult.applicable > 0) {
    lines.push(`  Applying will create branch \x1b[36m${branchName}\x1b[0m`);
    lines.push(`  and commit ${dryRunResult.applicable} patch(es) to ${repoRoot}`);
  } else if (!dryRunResult.safe) {
    lines.push(`  \x1b[31mApply blocked — safety violations detected\x1b[0m`);
  } else {
    lines.push(`  \x1b[33mNo applicable patches — nothing to apply\x1b[0m`);
  }
  lines.push("");

  return lines.join("\n");
}

// ── Interactive prompt ───────────────────────────────────────────────

export async function promptConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<boolean>((resolve) => {
    rl.question("  Apply these changes? [y/N] ", (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

// ── Combined flow ────────────────────────────────────────────────────

/**
 * Show preview and resolve confirmation.
 *
 * - If `confirmApply` is true (--confirm-apply flag): shows preview, skips prompt, returns confirmed.
 * - If `interactive` is true: shows preview, prompts user, returns their answer.
 * - If neither: shows preview, returns declined.
 */
export async function confirmWithPreview(
  data: PreviewData,
  options: {
    confirmApply: boolean;
    interactive: boolean;
    log: (...args: unknown[]) => void;
  },
): Promise<ConfirmationResult> {
  const preview = renderPreview(data);
  options.log(preview);

  // Non-interactive explicit confirmation (scripted mode)
  if (options.confirmApply) {
    options.log("  ✓ Confirmation: --confirm-apply (non-interactive)\n");
    return { previewShown: true, confirmed: true, source: "flag" };
  }

  // Interactive prompt
  if (options.interactive) {
    const accepted = await promptConfirmation();
    if (accepted) {
      options.log("  ✓ Confirmation: accepted (interactive)\n");
      return { previewShown: true, confirmed: true, source: "interactive" };
    } else {
      options.log("  ✗ Confirmation: declined (interactive)\n");
      return { previewShown: true, confirmed: false, source: "declined" };
    }
  }

  // No confirmation mechanism available
  options.log("  ⚠ No confirmation provided. Use --confirm-apply or --interactive.\n");
  return { previewShown: true, confirmed: false, source: "declined" };
}
