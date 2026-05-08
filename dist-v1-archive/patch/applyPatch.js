"use strict";
/**
 * Patch applicator with rollback support.
 *
 * Applies validated patches to the working tree. Requires a successful
 * dry-run result before any mutation is allowed.
 *
 * If any patch fails mid-apply, all mutations are reverted.
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
exports.applyPatches = applyPatches;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const parseDiff_1 = require("./parseDiff");
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
function applyPatches(patches, options) {
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
    const applicableSet = new Set();
    for (const check of dryRunResult.patchChecks) {
        if (check.status === "applicable") {
            applicableSet.add(check.patchIndex);
        }
    }
    const backups = [];
    const fileResults = [];
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
            const backup = {
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
        }
        catch (err) {
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
function applyCreate(absPath, diff) {
    const parseResult = (0, parseDiff_1.parseDiff)(diff);
    if (!parseResult.ok) {
        throw new Error(`Cannot parse create diff: ${parseResult.error.message}`);
    }
    // Extract added lines from all hunks
    const lines = [];
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
function applyModify(absPath, diff, relocations) {
    const parseResult = (0, parseDiff_1.parseDiff)(diff);
    if (!parseResult.ok) {
        throw new Error(`Cannot parse modify diff: ${parseResult.error.message}`);
    }
    const original = fs.readFileSync(absPath, "utf-8");
    const fileLines = original.split("\n");
    // Build relocation lookup: hunkIndex → relocated 1-based start
    const relocationMap = new Map();
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
        const replacement = [];
        for (const line of hunk.lines) {
            if (line.type === "context" || line.type === "add") {
                replacement.push(line.content);
            }
        }
        fileLines.splice(startIdx, removeCount, ...replacement);
    }
    fs.writeFileSync(absPath, fileLines.join("\n"), "utf-8");
}
function applyDelete(absPath) {
    fs.unlinkSync(absPath);
}
// ── Rollback ─────────────────────────────────────────────────────────
function rollback(backups) {
    const errors = [];
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
        }
        catch (err) {
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
//# sourceMappingURL=applyPatch.js.map