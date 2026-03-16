/**
 * Patch applicator with rollback support.
 *
 * Applies validated patches to the working tree. Requires a successful
 * dry-run result before any mutation is allowed.
 *
 * If any patch fails mid-apply, all mutations are reverted.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { parseDiff, ParsedPatch } from "./parseDiff";
import { DryRunResult, PatchInput, PatchCheckResult } from "./dryRun";
import { HunkRelocation } from "./fuzzyMatch";

// ── Types ────────────────────────────────────────────────────────────

export interface ApplyOptions {
  /** Absolute path to repo root */
  repoRoot: string;
  /** Require explicit confirmation — apply refuses to run without this */
  confirmed: boolean;
  /** Dry-run result that must have passed */
  dryRunResult: DryRunResult;
}

export interface FileApplyResult {
  patchIndex: number;
  filePath: string;
  operation: "create" | "modify" | "delete";
  status: "applied" | "skipped" | "failed";
  detail: string;
}

export interface ApplyResult {
  applyId: string;
  timestamp: string;
  repoRoot: string;
  status: "applied" | "partial" | "failed" | "rejected" | "rolled_back";
  filesAttempted: number;
  filesChanged: number;
  fileResults: FileApplyResult[];
  rollback: {
    triggered: boolean;
    filesReverted: number;
    status: "not_needed" | "success" | "failed";
    errors: string[];
  };
  errors: string[];
}

// ── Backup tracking for rollback ─────────────────────────────────────

interface FileBackup {
  absPath: string;
  operation: "create" | "modify" | "delete";
  /** Original content for modify/delete; undefined for create */
  originalContent?: string;
  /** Whether the file existed before the operation */
  existed: boolean;
}

// ── Applicator ───────────────────────────────────────────────────────

/**
 * Apply validated patches to the working tree.
 *
 * Preconditions:
 * - `options.confirmed` must be true
 * - `options.dryRunResult.safe` must be true
 * - Only patches with dry-run status `applicable` will be applied
 *
 * On failure: all mutations are rolled back.
 */
export function applyPatches(
  patches: PatchInput[],
  options: ApplyOptions,
): ApplyResult {
  const applyId = `apply_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = new Date().toISOString();
  const { repoRoot, confirmed, dryRunResult } = options;

  // Gate 1: Confirmation required
  if (!confirmed) {
    return {
      applyId,
      timestamp,
      repoRoot,
      status: "rejected",
      filesAttempted: 0,
      filesChanged: 0,
      fileResults: [],
      rollback: { triggered: false, filesReverted: 0, status: "not_needed", errors: [] },
      errors: ["Apply rejected: confirmation not provided. Pass confirmed: true to proceed."],
    };
  }

  // Gate 2: Dry-run must have passed safety
  if (!dryRunResult.safe) {
    return {
      applyId,
      timestamp,
      repoRoot,
      status: "rejected",
      filesAttempted: 0,
      filesChanged: 0,
      fileResults: [],
      rollback: { triggered: false, filesReverted: 0, status: "not_needed", errors: [] },
      errors: [`Apply rejected: dry-run has safety violations (${dryRunResult.safetyViolations.length}).`],
    };
  }

  // Gate 3: At least one applicable patch
  if (dryRunResult.applicable === 0) {
    return {
      applyId,
      timestamp,
      repoRoot,
      status: "rejected",
      filesAttempted: 0,
      filesChanged: 0,
      fileResults: [],
      rollback: { triggered: false, filesReverted: 0, status: "not_needed", errors: [] },
      errors: ["Apply rejected: no applicable patches in dry-run result."],
    };
  }

  // Build applicability index from dry-run
  const applicableSet = new Set<number>();
  for (const check of dryRunResult.patchChecks) {
    if (check.status === "applicable") {
      applicableSet.add(check.patchIndex);
    }
  }

  const backups: FileBackup[] = [];
  const fileResults: FileApplyResult[] = [];
  let filesChanged = 0;
  let failed = false;

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const absPath = path.resolve(repoRoot, patch.filePath);

    // Skip non-applicable patches
    if (!applicableSet.has(i)) {
      fileResults.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "skipped",
        detail: `Dry-run status: ${dryRunResult.patchChecks[i]?.status || "unknown"}`,
      });
      continue;
    }

    try {
      // Backup before mutation
      const existed = fs.existsSync(absPath);
      const backup: FileBackup = {
        absPath,
        operation: patch.operation,
        existed,
        originalContent: existed ? fs.readFileSync(absPath, "utf-8") : undefined,
      };
      backups.push(backup);

      // Apply
      switch (patch.operation) {
        case "create":
          applyCreate(absPath, patch.diff);
          break;
        case "modify": {
          const check = dryRunResult.patchChecks[i];
          applyModify(absPath, patch.diff, check?.relocations);
          break;
        }
        case "delete":
          applyDelete(absPath);
          break;
      }

      fileResults.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "applied",
        detail: `${patch.operation} successful`,
      });
      filesChanged++;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fileResults.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "failed",
        detail: message,
      });
      failed = true;
      break; // Stop and rollback
    }
  }

  // Rollback if any patch failed
  if (failed) {
    const rollbackResult = rollback(backups);
    return {
      applyId,
      timestamp,
      repoRoot,
      status: "rolled_back",
      filesAttempted: fileResults.filter((r) => r.status !== "skipped").length,
      filesChanged,
      fileResults,
      rollback: rollbackResult,
      errors: fileResults.filter((r) => r.status === "failed").map((r) => `${r.filePath}: ${r.detail}`),
    };
  }

  const skipped = fileResults.filter((r) => r.status === "skipped").length;
  const status = skipped > 0 && filesChanged > 0 ? "partial" : "applied";

  return {
    applyId,
    timestamp,
    repoRoot,
    status,
    filesAttempted: fileResults.filter((r) => r.status !== "skipped").length,
    filesChanged,
    fileResults,
    rollback: { triggered: false, filesReverted: 0, status: "not_needed", errors: [] },
    errors: [],
  };
}

// ── Operation implementations ────────────────────────────────────────

function applyCreate(absPath: string, diff: string): void {
  const parseResult = parseDiff(diff);
  if (!parseResult.ok) {
    throw new Error(`Cannot parse create diff: ${parseResult.error.message}`);
  }

  // Extract added lines from all hunks
  const lines: string[] = [];
  for (const hunk of parseResult.patch.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") {
        lines.push(line.content);
      }
    }
  }

  // Ensure parent directory exists
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(absPath, lines.join("\n"), "utf-8");
}

function applyModify(absPath: string, diff: string, relocations?: HunkRelocation[]): void {
  const parseResult = parseDiff(diff);
  if (!parseResult.ok) {
    throw new Error(`Cannot parse modify diff: ${parseResult.error.message}`);
  }

  const original = fs.readFileSync(absPath, "utf-8");
  const fileLines = original.split("\n");

  // Build relocation lookup: hunkIndex → relocated 1-based start
  const relocationMap = new Map<number, number>();
  if (relocations) {
    for (const r of relocations) {
      relocationMap.set(r.hunkIndex, r.relocatedStart);
    }
  }

  // Apply hunks in reverse order to preserve line numbers
  // Use relocated positions when available
  const indexedHunks = parseResult.patch.hunks.map((hunk, idx) => ({
    hunk,
    effectiveStart: relocationMap.get(idx) ?? hunk.oldStart,
  }));
  const sortedHunks = indexedHunks.sort((a, b) => b.effectiveStart - a.effectiveStart);

  for (const { hunk, effectiveStart } of sortedHunks) {
    const startIdx = effectiveStart - 1; // Convert to 0-based

    // Count lines to remove (context + remove lines from old side)
    let removeCount = 0;
    for (const line of hunk.lines) {
      if (line.type === "context" || line.type === "remove") {
        removeCount++;
      }
    }

    // Build replacement lines (context + add)
    const replacement: string[] = [];
    for (const line of hunk.lines) {
      if (line.type === "context" || line.type === "add") {
        replacement.push(line.content);
      }
    }

    fileLines.splice(startIdx, removeCount, ...replacement);
  }

  fs.writeFileSync(absPath, fileLines.join("\n"), "utf-8");
}

function applyDelete(absPath: string): void {
  fs.unlinkSync(absPath);
}

// ── Rollback ─────────────────────────────────────────────────────────

function rollback(backups: FileBackup[]): ApplyResult["rollback"] {
  const errors: string[] = [];
  let reverted = 0;

  // Revert in reverse order
  for (let i = backups.length - 1; i >= 0; i--) {
    const backup = backups[i];
    try {
      switch (backup.operation) {
        case "create":
          // Undo create: delete the file we created
          if (fs.existsSync(backup.absPath)) {
            fs.unlinkSync(backup.absPath);
          }
          break;

        case "modify":
          // Undo modify: restore original content
          if (backup.originalContent !== undefined) {
            fs.writeFileSync(backup.absPath, backup.originalContent, "utf-8");
          }
          break;

        case "delete":
          // Undo delete: recreate with original content
          if (backup.originalContent !== undefined) {
            const dir = path.dirname(backup.absPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(backup.absPath, backup.originalContent, "utf-8");
          }
          break;
      }
      reverted++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Rollback failed for ${backup.absPath}: ${message}`);
    }
  }

  return {
    triggered: true,
    filesReverted: reverted,
    status: errors.length === 0 ? "success" : "failed",
    errors,
  };
}
