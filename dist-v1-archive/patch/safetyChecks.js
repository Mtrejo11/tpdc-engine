"use strict";
/**
 * Patch safety boundary checks.
 *
 * Enforces configurable rules before any patch can be considered
 * for application. All checks are read-only — nothing is mutated.
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
exports.DEFAULT_DENY_PATTERNS = void 0;
exports.defaultSafetyConfig = defaultSafetyConfig;
exports.checkSafety = checkSafety;
const path = __importStar(require("path"));
/** Default deny patterns for sensitive files */
exports.DEFAULT_DENY_PATTERNS = [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.secret",
    "credentials.json",
    "secrets.json",
    "*.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    ".git/*",
    "node_modules/*",
];
/** Default safety config */
function defaultSafetyConfig(repoRoot) {
    return {
        repoRoot,
        denyPatterns: exports.DEFAULT_DENY_PATTERNS,
        maxTargetFiles: 20,
        maxTotalDiffSize: 500_000,
    };
}
/**
 * Check a set of patches against safety rules.
 */
function checkSafety(patches, config) {
    const violations = [];
    const normalizedRoot = path.resolve(config.repoRoot);
    // Check max files
    const uniqueFiles = new Set(patches.map((p) => p.filePath));
    if (uniqueFiles.size > config.maxTargetFiles) {
        violations.push({
            patchIndex: -1,
            filePath: "",
            rule: "max_files_exceeded",
            detail: `Patch targets ${uniqueFiles.size} files, limit is ${config.maxTargetFiles}`,
        });
    }
    // Check max total diff size
    const totalDiffSize = patches.reduce((sum, p) => sum + p.diff.length, 0);
    if (totalDiffSize > config.maxTotalDiffSize) {
        violations.push({
            patchIndex: -1,
            filePath: "",
            rule: "max_diff_exceeded",
            detail: `Total diff size ${totalDiffSize} chars exceeds limit of ${config.maxTotalDiffSize}`,
        });
    }
    for (let i = 0; i < patches.length; i++) {
        const { filePath } = patches[i];
        // Check outside repo root
        const absPath = path.resolve(normalizedRoot, filePath);
        if (!absPath.startsWith(normalizedRoot + path.sep) && absPath !== normalizedRoot) {
            violations.push({
                patchIndex: i,
                filePath,
                rule: "outside_repo",
                detail: `Path resolves outside repo root: ${absPath}`,
            });
            continue;
        }
        // Check deny patterns
        if (matchesDenyPattern(filePath, config.denyPatterns)) {
            violations.push({
                patchIndex: i,
                filePath,
                rule: "denied_file",
                detail: `File matches deny pattern`,
            });
        }
        // Check allowlist
        if (config.allowPaths && config.allowPaths.length > 0) {
            if (!config.allowPaths.some((allowed) => filePath.startsWith(allowed))) {
                violations.push({
                    patchIndex: i,
                    filePath,
                    rule: "not_in_allowlist",
                    detail: `File not in allowed paths: ${config.allowPaths.join(", ")}`,
                });
            }
        }
    }
    return { safe: violations.length === 0, violations };
}
/**
 * Simple glob-like pattern matching for deny rules.
 * Supports: exact match, *.ext, prefix/*, .name.*
 */
function matchesDenyPattern(filePath, patterns) {
    const basename = path.basename(filePath);
    for (const pattern of patterns) {
        // Exact basename match (e.g., ".env", "credentials.json")
        if (basename === pattern)
            return true;
        // Wildcard extension (e.g., "*.pem", "*.lock")
        if (pattern.startsWith("*.")) {
            const ext = pattern.substring(1); // ".pem"
            if (basename.endsWith(ext))
                return true;
        }
        // Prefix with extension wildcard (e.g., ".env.*")
        if (pattern.includes(".*")) {
            const prefix = pattern.split(".*")[0];
            if (basename.startsWith(prefix + "."))
                return true;
        }
        // Directory wildcard (e.g., ".git/*", "node_modules/*")
        if (pattern.endsWith("/*")) {
            const dir = pattern.slice(0, -2);
            if (filePath.startsWith(dir + "/") || filePath === dir)
                return true;
        }
    }
    return false;
}
//# sourceMappingURL=safetyChecks.js.map