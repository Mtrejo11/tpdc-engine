/**
 * Execute Patch Mode — repo-aware patch generation.
 *
 * Wraps runCapability("execute-patch") with repo context injection.
 * Does NOT apply patches. Output is a PatchArtifact.
 */

import { runCapability, RunResult } from "./runCapability";
import { LLMAdapter } from "./types";
import { buildRepoContext, formatRepoContext } from "./repoContext";

export interface ExecutePatchOptions {
  llm: LLMAdapter;
  repoRoot: string;
  fileHints?: string[];
  runId?: string;
  quiet?: boolean;
}

export async function executePatch(
  planArtifact: Record<string, unknown>,
  options: ExecutePatchOptions,
): Promise<RunResult> {
  const { llm, repoRoot, fileHints = [], runId, quiet } = options;

  // Extract plan steps for repo context building
  const steps = (planArtifact.steps as Array<{
    description: string;
    acceptanceCriteria: string;
    title: string;
  }>) || [];

  // Build repo context from real filesystem
  const repoCtx = buildRepoContext(repoRoot, steps, fileHints);

  // Combine plan + repo context into a single input for the LLM
  const augmentedInput = {
    plan: planArtifact,
    repoContext: {
      repoRoot: repoCtx.repoRoot,
      existingFiles: repoCtx.existingFiles,
      fileContents: repoCtx.fileContents,
    },
  };

  // Delegate to the standard runCapability with execute-patch capability
  return runCapability("execute-patch", augmentedInput, {
    llm,
    runId,
    quiet,
  });
}
