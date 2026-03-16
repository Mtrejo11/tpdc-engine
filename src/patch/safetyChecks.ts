/**
 * Patch safety boundary checks.
 *
 * Enforces configurable rules before any patch can be considered
 * for application. All checks are read-only — nothing is mutated.
 */

import * as path from "path";

export interface SafetyConfig {
  /** Repo root — patches must not target files outside this */
  repoRoot: string;
  /** Glob patterns for denied file paths (e.g., ".env", "*.lock") */
  denyPatterns: string[];
  /** If set, only these paths are allowed (relative to repoRoot) */
  allowPaths?: string[];
  /** Maximum number of files a single PatchArtifact can target */
  maxTargetFiles: number;
  /** Maximum total diff size in characters across all patches */
  maxTotalDiffSize: number;
}

export interface SafetyViolation {
  patchIndex: number;
  filePath: string;
  rule: "denied_file" | "outside_repo" | "not_in_allowlist" | "max_files_exceeded" | "max_diff_exceeded";
  detail: string;
}

export interface SafetyResult {
  safe: boolean;
  violations: SafetyViolation[];
}

/** Default deny patterns for sensitive files */
export const DEFAULT_DENY_PATTERNS: string[] = [
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
export function defaultSafetyConfig(repoRoot: string): SafetyConfig {
  return {
    repoRoot,
    denyPatterns: DEFAULT_DENY_PATTERNS,
    maxTargetFiles: 20,
    maxTotalDiffSize: 500_000,
  };
}

/**
 * Check a set of patches against safety rules.
 */
export function checkSafety(
  patches: Array<{ filePath: string; diff: string }>,
  config: SafetyConfig,
): SafetyResult {
  const violations: SafetyViolation[] = [];
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
function matchesDenyPattern(filePath: string, patterns: string[]): boolean {
  const basename = path.basename(filePath);

  for (const pattern of patterns) {
    // Exact basename match (e.g., ".env", "credentials.json")
    if (basename === pattern) return true;

    // Wildcard extension (e.g., "*.pem", "*.lock")
    if (pattern.startsWith("*.")) {
      const ext = pattern.substring(1); // ".pem"
      if (basename.endsWith(ext)) return true;
    }

    // Prefix with extension wildcard (e.g., ".env.*")
    if (pattern.includes(".*")) {
      const prefix = pattern.split(".*")[0];
      if (basename.startsWith(prefix + ".")) return true;
    }

    // Directory wildcard (e.g., ".git/*", "node_modules/*")
    if (pattern.endsWith("/*")) {
      const dir = pattern.slice(0, -2);
      if (filePath.startsWith(dir + "/") || filePath === dir) return true;
    }
  }

  return false;
}
