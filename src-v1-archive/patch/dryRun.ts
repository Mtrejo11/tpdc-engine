/**
 * Dry-run validator for PatchArtifact.
 *
 * Checks whether each patch would apply cleanly against the current
 * working tree without actually modifying any files.
 */

import * as fs from "fs";
import * as path from "path";
import { parseDiff, ParsedPatch, DiffHunk } from "./parseDiff";
import { checkSafety, SafetyConfig, SafetyResult, SafetyViolation } from "./safetyChecks";
import { relocateHunks, HunkRelocation, FuzzyMatchOptions } from "./fuzzyMatch";

export interface PatchCheckResult {
  patchIndex: number;
  filePath: string;
  operation: string;
  status: "applicable" | "conflict" | "missing_file" | "file_exists" | "malformed_diff";
  detail: string;
  /** Hunk relocation info when fuzzy matching was used */
  relocations?: HunkRelocation[];
}

export interface DryRunResult {
  safe: boolean;
  safetyViolations: SafetyViolation[];
  patchChecks: PatchCheckResult[];
  applicable: number;
  conflicts: number;
  errors: number;
  summary: string;
}

export interface PatchInput {
  filePath: string;
  operation: "create" | "modify" | "delete";
  diff: string;
}

/**
 * Run a complete dry-run validation of a PatchArtifact's patches.
 *
 * 1. Safety boundary checks (deny patterns, repo root, limits)
 * 2. Diff parsing validation
 * 3. Context matching against actual file contents
 */
export function dryRunValidate(
  patches: PatchInput[],
  safetyConfig: SafetyConfig,
): DryRunResult {
  // Step 1: Safety checks
  const safetyResult: SafetyResult = checkSafety(patches, safetyConfig);

  // Step 2+3: Per-patch validation
  const patchChecks: PatchCheckResult[] = [];

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const absPath = path.resolve(safetyConfig.repoRoot, patch.filePath);
    const fileExists = fs.existsSync(absPath);

    // Operation vs filesystem state
    if (patch.operation === "create") {
      if (fileExists) {
        patchChecks.push({
          patchIndex: i,
          filePath: patch.filePath,
          operation: patch.operation,
          status: "file_exists",
          detail: "Create target already exists",
        });
        continue;
      }
      // For create, just validate the diff parses
      const parseResult = parseDiff(patch.diff);
      if (!parseResult.ok) {
        patchChecks.push({
          patchIndex: i,
          filePath: patch.filePath,
          operation: patch.operation,
          status: "malformed_diff",
          detail: parseResult.error.message,
        });
        continue;
      }
      patchChecks.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "applicable",
        detail: "File does not exist; create is valid",
      });
      continue;
    }

    if (patch.operation === "delete") {
      if (!fileExists) {
        patchChecks.push({
          patchIndex: i,
          filePath: patch.filePath,
          operation: patch.operation,
          status: "missing_file",
          detail: "Delete target does not exist",
        });
        continue;
      }
      patchChecks.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "applicable",
        detail: "File exists; delete is valid",
      });
      continue;
    }

    // modify operation
    if (!fileExists) {
      patchChecks.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "missing_file",
        detail: "Modify target does not exist",
      });
      continue;
    }

    // Parse the diff
    const parseResult = parseDiff(patch.diff);
    if (!parseResult.ok) {
      patchChecks.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "malformed_diff",
        detail: parseResult.error.message,
      });
      continue;
    }

    // Context match: verify hunk context lines match actual file content
    // Uses fuzzy relocation when exact line numbers don't match
    const fileContent = fs.readFileSync(absPath, "utf-8");
    const fileLines = fileContent.split("\n");
    const relocationResult = relocateHunks(parseResult.patch.hunks, fileLines);

    if (relocationResult.ok) {
      const fuzzyCount = relocationResult.relocations.filter((r) => r.confidence === "fuzzy").length;
      const detail = fuzzyCount > 0
        ? `${parseResult.patch.hunks.length} hunk(s) match file content (${fuzzyCount} relocated via fuzzy match)`
        : `${parseResult.patch.hunks.length} hunk(s) match file content`;
      patchChecks.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "applicable",
        detail,
        relocations: relocationResult.relocations,
      });
    } else {
      patchChecks.push({
        patchIndex: i,
        filePath: patch.filePath,
        operation: patch.operation,
        status: "conflict",
        detail: relocationResult.detail,
      });
    }
  }

  const applicable = patchChecks.filter((c) => c.status === "applicable").length;
  const conflicts = patchChecks.filter((c) => c.status === "conflict").length;
  const errors = patchChecks.filter((c) =>
    c.status === "missing_file" || c.status === "file_exists" || c.status === "malformed_diff"
  ).length;

  const summaryParts: string[] = [];
  summaryParts.push(`${applicable}/${patches.length} patches applicable`);
  if (conflicts > 0) summaryParts.push(`${conflicts} conflict(s)`);
  if (errors > 0) summaryParts.push(`${errors} error(s)`);
  if (!safetyResult.safe) summaryParts.push(`${safetyResult.violations.length} safety violation(s)`);

  return {
    safe: safetyResult.safe,
    safetyViolations: safetyResult.violations,
    patchChecks,
    applicable,
    conflicts,
    errors,
    summary: summaryParts.join(", "),
  };
}

