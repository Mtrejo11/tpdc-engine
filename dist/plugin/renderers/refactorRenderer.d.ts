/**
 * Renderer for `tpdc refactor` output.
 *
 * Emphasizes structural improvements, affected files,
 * risk level, and expected benefits.
 */
import { RefactorArtifact } from "../handlers/refactorArtifact";
import { RunSummary } from "../../storage/runs";
export declare function renderRefactorResult(run: RunSummary, artifact: RefactorArtifact): string;
