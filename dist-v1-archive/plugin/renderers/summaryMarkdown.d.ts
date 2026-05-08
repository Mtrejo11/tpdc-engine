/**
 * Generates a polished summary.md for a workflow run.
 *
 * Persisted to the run's artifact directory for human consumption.
 * Mutation runs include expanded git/apply/rollback details.
 */
import { RunSummary } from "../../storage/runs";
export declare function renderSummaryMarkdown(run: RunSummary): string;
