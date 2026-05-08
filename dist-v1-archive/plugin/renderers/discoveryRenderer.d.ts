/**
 * Renderer for `tpdc discovery` output.
 *
 * Emphasizes framing, questions, options, and readiness —
 * not execution details.
 */
import { DiscoveryArtifact } from "../handlers/discoveryArtifact";
import { RunSummary } from "../../storage/runs";
export declare function renderDiscoveryResult(artifact: DiscoveryArtifact, run: RunSummary): string;
/**
 * Render a discovery-oriented summary.md (not the generic workflow one).
 */
export declare function renderDiscoveryMarkdown(artifact: DiscoveryArtifact, run: RunSummary): string;
