"use strict";
/**
 * Git integration for patch apply.
 *
 * Wraps the existing applyPatches function with branch creation,
 * staging, and commit. Does not change patch application logic.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBranchName = buildBranchName;
exports.buildCommitMessage = buildCommitMessage;
exports.gitApplyPatches = gitApplyPatches;
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const applyPatch_1 = require("./applyPatch");
// ── Git helpers ──────────────────────────────────────────────────────
function git(repoRoot, ...args) {
    return (0, child_process_1.execFileSync)("git", args, {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
    }).trim();
}
function gitSafe(repoRoot, ...args) {
    try {
        const output = git(repoRoot, ...args);
        return { ok: true, output };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: message };
    }
}
// ── Branch naming ────────────────────────────────────────────────────
function buildBranchName(runId) {
    // Extract a short timestamp + hash from the runId if it follows our convention
    // e.g., "apply_1773098000000_abcdef12" → "20260310-abcdef12"
    const parts = runId.split("_");
    let suffix;
    if (parts.length >= 3) {
        const ts = parseInt(parts[1], 10);
        const hash = parts[2];
        if (!isNaN(ts)) {
            const d = new Date(ts);
            const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
            suffix = `${dateStr}-${hash}`;
        }
        else {
            suffix = hash || crypto.randomBytes(4).toString("hex");
        }
    }
    else {
        suffix = crypto.randomBytes(4).toString("hex");
    }
    return `tpdc/run-${suffix}`;
}
// ── Commit message ───────────────────────────────────────────────────
function buildCommitMessage(applyResult, options) {
    const lines = [];
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
function gitApplyPatches(patches, options) {
    const { repoRoot, runId, planTitle, patchArtifactRef, changeSummary } = options;
    const emptyGit = {
        branchCreated: false,
        branchName: "",
        commitCreated: false,
        commitHash: "",
        filesStaged: [],
        errors: [],
    };
    // Verify this is a git repo
    const isRepo = gitSafe(repoRoot, "rev-parse", "--is-inside-work-tree");
    if (!isRepo.ok) {
        const applyResult = {
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
        if (hadDirtyFiles)
            gitSafe(repoRoot, "stash", "pop");
        const applyResult = {
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
    const applyResult = (0, applyPatch_1.applyPatches)(patches, {
        repoRoot: options.repoRoot,
        confirmed: options.confirmed,
        dryRunResult: options.dryRunResult,
    });
    // Step 3: If apply failed, switch back to original branch
    if (applyResult.status !== "applied" && applyResult.status !== "partial") {
        // Checkout original branch, delete the failed branch
        gitSafe(repoRoot, "checkout", originalRef);
        gitSafe(repoRoot, "branch", "-D", branchName);
        if (hadDirtyFiles)
            gitSafe(repoRoot, "stash", "pop");
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
    const filesStaged = [];
    const gitErrors = [];
    for (const fileResult of applyResult.fileResults) {
        if (fileResult.status !== "applied")
            continue;
        if (fileResult.operation === "delete") {
            const rm = gitSafe(repoRoot, "rm", "--cached", fileResult.filePath);
            if (rm.ok) {
                filesStaged.push(fileResult.filePath);
            }
            else {
                gitErrors.push(`Failed to stage deletion of ${fileResult.filePath}: ${rm.output}`);
            }
        }
        else {
            const add = gitSafe(repoRoot, "add", fileResult.filePath);
            if (add.ok) {
                filesStaged.push(fileResult.filePath);
            }
            else {
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
        if (hadDirtyFiles)
            gitSafe(repoRoot, "stash", "pop");
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
//# sourceMappingURL=gitIntegration.js.map