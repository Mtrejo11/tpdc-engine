/**
 * Git integration for patch apply.
 *
 * Wraps the existing applyPatches function with branch creation,
 * staging, and commit. Does not change patch application logic.
 */

import { execFileSync } from "child_process";
import * as crypto from "crypto";
import { applyPatches, ApplyOptions, ApplyResult } from "./applyPatch";
import { PatchInput } from "./dryRun";

// ── Types ────────────────────────────────────────────────────────────

export interface GitApplyOptions extends ApplyOptions {
  /** Run ID for branch naming and traceability */
  runId: string;
  /** Optional plan title for the commit message */
  planTitle?: string;
  /** Optional patch artifact reference (e.g., filename or path) */
  patchArtifactRef?: string;
  /** Short summary of what the patches do */
  changeSummary?: string;
}

export interface GitApplyResult {
  applyResult: ApplyResult;
  git: {
    branchCreated: boolean;
    branchName: string;
    commitCreated: boolean;
    commitHash: string;
    filesStaged: string[];
    errors: string[];
  };
}

// ── Git helpers ──────────────────────────────────────────────────────

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitSafe(repoRoot: string, ...args: string[]): { ok: boolean; output: string } {
  try {
    const output = git(repoRoot, ...args);
    return { ok: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

// ── Branch naming ────────────────────────────────────────────────────

export function buildBranchName(runId: string): string {
  // Extract a short timestamp + hash from the runId if it follows our convention
  // e.g., "apply_1773098000000_abcdef12" → "20260310-abcdef12"
  const parts = runId.split("_");
  let suffix: string;

  if (parts.length >= 3) {
    const ts = parseInt(parts[1], 10);
    const hash = parts[2];
    if (!isNaN(ts)) {
      const d = new Date(ts);
      const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      suffix = `${dateStr}-${hash}`;
    } else {
      suffix = hash || crypto.randomBytes(4).toString("hex");
    }
  } else {
    suffix = crypto.randomBytes(4).toString("hex");
  }

  return `tpdc/run-${suffix}`;
}

// ── Commit message ───────────────────────────────────────────────────

export function buildCommitMessage(
  applyResult: ApplyResult,
  options: {
    runId: string;
    patchArtifactRef?: string;
    planTitle?: string;
    changeSummary?: string;
    patchCount: number;
  },
): string {
  const lines: string[] = [];

  lines.push("TPDC Apply");
  lines.push("");
  lines.push(`Run ID: ${options.runId}`);
  if (options.patchArtifactRef) {
    lines.push(`Patch Artifact: ${options.patchArtifactRef}`);
  }
  if (options.planTitle) {
    lines.push(`Plan: ${options.planTitle}`);
  }
  lines.push(`Timestamp: ${applyResult.timestamp}`);
  lines.push(`Patches Applied: ${options.patchCount}`);
  lines.push("");

  // Files changed
  const changedFiles = applyResult.fileResults
    .filter((r) => r.status === "applied")
    .map((r) => r.filePath);

  if (changedFiles.length > 0) {
    lines.push("Files changed:");
    for (const f of changedFiles) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  // Summary
  if (options.changeSummary) {
    lines.push("Summary:");
    lines.push(options.changeSummary);
  }

  return lines.join("\n");
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Apply patches with Git integration.
 *
 * Flow:
 * 1. Create branch from current HEAD
 * 2. Apply patches (delegates to existing applyPatches)
 * 3. If apply succeeded: stage changed files → commit
 * 4. If apply failed/rolled back: no git mutations, stay on original branch
 */
export function gitApplyPatches(
  patches: PatchInput[],
  options: GitApplyOptions,
): GitApplyResult {
  const { repoRoot, runId, planTitle, patchArtifactRef, changeSummary } = options;

  const emptyGit = {
    branchCreated: false,
    branchName: "",
    commitCreated: false,
    commitHash: "",
    filesStaged: [],
    errors: [] as string[],
  };

  // Verify this is a git repo
  const isRepo = gitSafe(repoRoot, "rev-parse", "--is-inside-work-tree");
  if (!isRepo.ok) {
    const applyResult: ApplyResult = {
      applyId: `apply_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      timestamp: new Date().toISOString(),
      repoRoot,
      status: "rejected",
      filesAttempted: 0,
      filesChanged: 0,
      fileResults: [],
      rollback: { triggered: false, filesReverted: 0, status: "not_needed", errors: [] },
      errors: ["Git integration requires a git repository."],
    };
    return { applyResult, git: { ...emptyGit, errors: ["Not a git repository"] } };
  }

  // Save current branch to restore on failure
  const originalBranch = gitSafe(repoRoot, "rev-parse", "--abbrev-ref", "HEAD");
  const originalRef = originalBranch.ok ? originalBranch.output : "HEAD";

  // Stash any pre-existing dirty changes so the commit only includes TPDC patches
  const statusCheck = gitSafe(repoRoot, "status", "--porcelain");
  const hadDirtyFiles = statusCheck.ok && statusCheck.output.trim().length > 0;
  if (hadDirtyFiles) {
    gitSafe(repoRoot, "stash", "push", "-u", "-m", "tpdc-engine: pre-apply stash");
  }

  // Step 1: Create branch
  let branchName = buildBranchName(runId);

  // Check if branch exists, append suffix if so
  const branchExists = gitSafe(repoRoot, "rev-parse", "--verify", branchName);
  if (branchExists.ok) {
    branchName += `-${crypto.randomBytes(2).toString("hex")}`;
  }

  const createBranch = gitSafe(repoRoot, "checkout", "-b", branchName);
  if (!createBranch.ok) {
    if (hadDirtyFiles) gitSafe(repoRoot, "stash", "pop");
    const applyResult: ApplyResult = {
      applyId: `apply_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      timestamp: new Date().toISOString(),
      repoRoot,
      status: "rejected",
      filesAttempted: 0,
      filesChanged: 0,
      fileResults: [],
      rollback: { triggered: false, filesReverted: 0, status: "not_needed", errors: [] },
      errors: [`Failed to create branch ${branchName}: ${createBranch.output}`],
    };
    return { applyResult, git: { ...emptyGit, errors: [createBranch.output] } };
  }

  // Step 2: Apply patches (existing logic, unchanged)
  const applyResult = applyPatches(patches, {
    repoRoot: options.repoRoot,
    confirmed: options.confirmed,
    dryRunResult: options.dryRunResult,
  });

  // Step 3: If apply failed, switch back to original branch
  if (applyResult.status !== "applied" && applyResult.status !== "partial") {
    // Checkout original branch, delete the failed branch
    gitSafe(repoRoot, "checkout", originalRef);
    gitSafe(repoRoot, "branch", "-D", branchName);
    if (hadDirtyFiles) gitSafe(repoRoot, "stash", "pop");

    return {
      applyResult,
      git: {
        branchCreated: false,
        branchName,
        commitCreated: false,
        commitHash: "",
        filesStaged: [],
        errors: [`Apply status ${applyResult.status} — branch ${branchName} deleted, reverted to ${originalRef}`],
      },
    };
  }

  // Step 4: Stage only the applied files
  const filesStaged: string[] = [];
  const gitErrors: string[] = [];

  for (const fileResult of applyResult.fileResults) {
    if (fileResult.status !== "applied") continue;

    if (fileResult.operation === "delete") {
      const rm = gitSafe(repoRoot, "rm", "--cached", fileResult.filePath);
      if (rm.ok) {
        filesStaged.push(fileResult.filePath);
      } else {
        gitErrors.push(`Failed to stage deletion of ${fileResult.filePath}: ${rm.output}`);
      }
    } else {
      const add = gitSafe(repoRoot, "add", fileResult.filePath);
      if (add.ok) {
        filesStaged.push(fileResult.filePath);
      } else {
        gitErrors.push(`Failed to stage ${fileResult.filePath}: ${add.output}`);
      }
    }
  }

  // Step 5: Commit
  const patchCount = applyResult.fileResults.filter((r) => r.status === "applied").length;
  const commitMsg = buildCommitMessage(applyResult, {
    runId,
    patchArtifactRef,
    planTitle,
    changeSummary,
    patchCount,
  });

  const commit = gitSafe(repoRoot, "commit", "-m", commitMsg);
  if (!commit.ok) {
    gitErrors.push(`Commit failed: ${commit.output}`);
    if (hadDirtyFiles) gitSafe(repoRoot, "stash", "pop");
    return {
      applyResult,
      git: {
        branchCreated: true,
        branchName,
        commitCreated: false,
        commitHash: "",
        filesStaged,
        errors: gitErrors,
      },
    };
  }

  // Get commit hash
  const hashResult = gitSafe(repoRoot, "rev-parse", "HEAD");
  const commitHash = hashResult.ok ? hashResult.output : "";

  // Restore stashed changes
  if (hadDirtyFiles) {
    gitSafe(repoRoot, "stash", "pop");
  }

  return {
    applyResult,
    git: {
      branchCreated: true,
      branchName,
      commitCreated: true,
      commitHash,
      filesStaged,
      errors: gitErrors,
    },
  };
}
