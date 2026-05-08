/**
 * Repo context provider for patch-mode execution.
 *
 * Reads relevant files from a real repository to provide grounding
 * context for patch generation. Does NOT write or mutate anything.
 */
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
export declare function buildRepoContext(repoRoot: string, planSteps: Array<{
    description: string;
    acceptanceCriteria: string;
    title: string;
}>, hints?: string[]): RepoContext;
/**
 * Format repo context as a text block for inclusion in LLM prompt input.
 */
export declare function formatRepoContext(ctx: RepoContext): string;
