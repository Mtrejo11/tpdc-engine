/**
 * Renderer for `tpdc diff <runId>`.
 *
 * Shows patch/diff details for mutation runs with:
 * - git metadata (branch, commit)
 * - dry-run outcome per file
 * - color-coded unified diffs
 * - apply result per file
 * - rollback info if present
 */
import { RunSummary } from "../../storage/runs";
export declare function renderDiff(run: RunSummary): string;
