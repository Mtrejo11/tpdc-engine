/**
 * Renderer for `tpdc assess` output.
 *
 * Emphasizes:
 * - scope analyzed
 * - findings with risk classification
 * - supporting evidence
 * - recommended actions
 */
import { RunSummary } from "../../storage/runs";
import { AssessmentContext } from "../handlers/assessNormalizer";
export declare function renderAssessResult(run: RunSummary, ctx: AssessmentContext): string;
