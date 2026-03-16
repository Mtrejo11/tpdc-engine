"use strict";
/**
 * Dry-run validator for PatchArtifact.
 *
 * Checks whether each patch would apply cleanly against the current
 * working tree without actually modifying any files.
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
exports.dryRunValidate = dryRunValidate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const parseDiff_1 = require("./parseDiff");
const safetyChecks_1 = require("./safetyChecks");
const fuzzyMatch_1 = require("./fuzzyMatch");
/**
 * Run a complete dry-run validation of a PatchArtifact's patches.
 *
 * 1. Safety boundary checks (deny patterns, repo root, limits)
 * 2. Diff parsing validation
 * 3. Context matching against actual file contents
 */
function dryRunValidate(patches, safetyConfig) {
    // Step 1: Safety checks
    const safetyResult = (0, safetyChecks_1.checkSafety)(patches, safetyConfig);
    // Step 2+3: Per-patch validation
    const patchChecks = [];
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
            const parseResult = (0, parseDiff_1.parseDiff)(patch.diff);
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
        const parseResult = (0, parseDiff_1.parseDiff)(patch.diff);
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
        const relocationResult = (0, fuzzyMatch_1.relocateHunks)(parseResult.patch.hunks, fileLines);
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
        }
        else {
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
    const errors = patchChecks.filter((c) => c.status === "missing_file" || c.status === "file_exists" || c.status === "malformed_diff").length;
    const summaryParts = [];
    summaryParts.push(`${applicable}/${patches.length} patches applicable`);
    if (conflicts > 0)
        summaryParts.push(`${conflicts} conflict(s)`);
    if (errors > 0)
        summaryParts.push(`${errors} error(s)`);
    if (!safetyResult.safe)
        summaryParts.push(`${safetyResult.violations.length} safety violation(s)`);
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
//# sourceMappingURL=dryRun.js.map