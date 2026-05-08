/**
 * Renderer for `tpdc plan` output.
 *
 * Emphasizes implementation phases, dependencies,
 * affected files, and readiness.
 */
import { PlanSummaryArtifact } from "../handlers/planArtifact";
import { RunSummary } from "../../storage/runs";
export declare function renderPlanResult(run: RunSummary, artifact: PlanSummaryArtifact): string;
/**
 * Render a plan-oriented summary.md.
 */
export declare function renderPlanMarkdown(artifact: PlanSummaryArtifact, run: RunSummary): string;
