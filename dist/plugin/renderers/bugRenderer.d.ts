/**
 * Renderer for `tpdc fix` output.
 *
 * Bug-oriented display that emphasizes:
 * - bug summary and affected surface
 * - missing context and blocking reason
 * - suggested clarified report (when blocked)
 * - root-cause / patch preview (when available)
 * - manual validation checklist
 */
import { RunSummary } from "../../storage/runs";
import { BugContext } from "../handlers/bugNormalizer";
export declare function renderBugResult(run: RunSummary, bugCtx: BugContext): string;
