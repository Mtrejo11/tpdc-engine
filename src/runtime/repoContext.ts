/**
 * Repo context provider for patch-mode execution.
 *
 * Reads relevant files from a real repository to provide grounding
 * context for patch generation. Does NOT write or mutate anything.
 */

import * as fs from "fs";
import * as path from "path";

export interface RepoContext {
  repoRoot: string;
  existingFiles: string[];
  fileContents: Record<string, string>;
}

/**
 * Build repo context by reading files relevant to the plan.
 *
 * @param repoRoot - Absolute path to the repository root
 * @param planSteps - Steps from the PlanArtifact (used to identify relevant files)
 * @param hints - Additional file paths to include (from design touchedArtifacts, etc.)
 */
export function buildRepoContext(
  repoRoot: string,
  planSteps: Array<{ description: string; acceptanceCriteria: string; title: string }>,
  hints: string[] = [],
): RepoContext {
  if (!fs.existsSync(repoRoot)) {
    throw new Error(`Repo root does not exist: ${repoRoot}`);
  }

  // Collect candidate file paths from plan text and hints
  const candidatePaths = new Set<string>(hints);

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
  const existingFiles: string[] = [];
  const fileContents: Record<string, string> = {};

  for (const candidate of candidatePaths) {
    const absPath = path.isAbsolute(candidate)
      ? candidate
      : path.join(repoRoot, candidate);

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
export function formatRepoContext(ctx: RepoContext): string {
  const lines: string[] = [];

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
