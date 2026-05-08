/**
 * Renderer for `tpdc show <runId>`.
 *
 * Displays a polished overview of a completed workflow run.
 */
import { RunSummary } from "../../storage/runs";
export declare function renderShow(run: RunSummary): string;
