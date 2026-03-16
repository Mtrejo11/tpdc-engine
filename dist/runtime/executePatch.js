"use strict";
/**
 * Execute Patch Mode — repo-aware patch generation.
 *
 * Wraps runCapability("execute-patch") with repo context injection.
 * Does NOT apply patches. Output is a PatchArtifact.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executePatch = executePatch;
const runCapability_1 = require("./runCapability");
const repoContext_1 = require("./repoContext");
async function executePatch(planArtifact, options) {
    const { llm, repoRoot, fileHints = [], runId, quiet } = options;
    // Extract plan steps for repo context building
    const steps = planArtifact.steps || [];
    // Build repo context from real filesystem
    const repoCtx = (0, repoContext_1.buildRepoContext)(repoRoot, steps, fileHints);
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
    return (0, runCapability_1.runCapability)("execute-patch", augmentedInput, {
        llm,
        runId,
        quiet,
    });
}
//# sourceMappingURL=executePatch.js.map