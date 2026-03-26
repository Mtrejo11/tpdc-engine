"use strict";
/**
 * Repo context provider for patch-mode execution.
 *
 * Reads relevant files from a real repository to provide grounding
 * context for patch generation. Does NOT write or mutate anything.
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
exports.buildRepoContext = buildRepoContext;
exports.formatRepoContext = formatRepoContext;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Build repo context by reading files relevant to the plan.
 *
 * @param repoRoot - Absolute path to the repository root
 * @param planSteps - Steps from the PlanArtifact (used to identify relevant files)
 * @param hints - Additional file paths to include (from design touchedArtifacts, etc.)
 */
function buildRepoContext(repoRoot, planSteps, hints = []) {
    if (!fs.existsSync(repoRoot)) {
        throw new Error(`Repo root does not exist: ${repoRoot}`);
    }
    // Collect candidate file paths from plan text and hints
    const candidatePaths = new Set(hints);
    for (const step of planSteps) {
        const text = `${step.title} ${step.description} ${step.acceptanceCriteria}`;
        // Extract file-like paths (e.g., src/foo.ts, lib/bar/baz.js)
        const pathMatches = text.match(/(?:^|\s|["'`(])([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,10})(?=[\s"'`),;:]|$)/g);
        if (pathMatches) {
            for (const match of pathMatches) {
                candidatePaths.add(match.trim().replace(/^["'`(]/, ""));
            }
        }
    }
    // Resolve and verify which files actually exist
    const existingFiles = [];
    const fileContents = {};
    for (const candidate of candidatePaths) {
        // Always resolve relative to repoRoot — never trust absolute paths from LLM output
        const absPath = path.resolve(repoRoot, candidate);
        // Ensure resolved path stays within repoRoot (prevents traversal via ../ or absolute paths)
        if (!absPath.startsWith(repoRoot + path.sep) && absPath !== repoRoot) {
            continue;
        }
        if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
            const relPath = path.relative(repoRoot, absPath);
            existingFiles.push(relPath);
            // Read file if it's reasonably sized (< 100KB)
            const stat = fs.statSync(absPath);
            if (stat.size < 100_000) {
                fileContents[relPath] = fs.readFileSync(absPath, "utf-8");
            }
        }
    }
    return { repoRoot, existingFiles, fileContents };
}
/**
 * Format repo context as a text block for inclusion in LLM prompt input.
 */
function formatRepoContext(ctx) {
    const lines = [];
    lines.push("## Repo Context");
    lines.push(`repoRoot: ${ctx.repoRoot}`);
    lines.push("");
    lines.push(`### Existing Files (${ctx.existingFiles.length})`);
    for (const f of ctx.existingFiles) {
        lines.push(`- ${f}`);
    }
    lines.push("");
    lines.push("### File Contents");
    for (const [filePath, content] of Object.entries(ctx.fileContents)) {
        lines.push(`#### ${filePath}`);
        lines.push("```");
        lines.push(content);
        lines.push("```");
        lines.push("");
    }
    return lines.join("\n");
}
//# sourceMappingURL=repoContext.js.map