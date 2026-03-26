/**
 * Plugin handler: workflow execution
 *
 * Thin wrapper over the existing runWorkflow orchestrator.
 * Enriches the result with per-stage artifact data for rendering.
 */

import { z } from "zod";
import { runWorkflow, WorkflowResult } from "../../runtime/workflow";
import { loadTypedArtifact } from "../../storage/local";
import { LLMAdapter } from "../../runtime/types";

export interface WorkflowCommandInput {
  text: string;
  title?: string;
}

export interface StageDetail {
  capabilityId: string;
  status: string;
  durationMs: number;
  blockReason?: string;
  validationErrors?: string[];
}

export interface WorkflowCommandResult {
  workflowId: string;
  request: string;
  timestamp: string;
  adapter: { adapterId: string; modelId: string; transport: string };
  stages: StageDetail[];
  finalVerdict: string;
  totalDurationMs: number;
  summary: string;
  // Enriched data pulled from saved artifacts
  score?: number;
  openQuestions?: Array<{ question: string; owner: string }>;
  findings?: Array<{ category: string; severity: string; description: string }>;
  blockReason?: string;
}

export async function runWorkflowHandler(
  input: WorkflowCommandInput,
  options: { llm: LLMAdapter; quiet?: boolean },
): Promise<WorkflowCommandResult> {
  // Build request — plain string or structured object with title
  const request = input.title
    ? { title: input.title, body: input.text, source: "plugin" }
    : input.text;

  // Delegate to existing orchestrator — no workflow logic here
  const result: WorkflowResult = await runWorkflow(request, {
    llm: options.llm,
    quiet: options.quiet ?? true,
  });

  // Enrich with data from saved artifacts
  const enriched = enrichFromArtifacts(result);

  return {
    workflowId: result.workflowId,
    request: input.text,
    timestamp: result.timestamp,
    adapter: result.adapter,
    stages: result.stages.map((s) => ({
      capabilityId: s.capabilityId,
      status: s.status,
      durationMs: s.durationMs,
      blockReason: s.blockReason,
      validationErrors: s.validationErrors,
    })),
    finalVerdict: result.finalVerdict,
    totalDurationMs: result.totalDurationMs,
    summary: result.summary,
    ...enriched,
  };
}

// Lightweight schemas for safe enrichment reads
const DecomposeEnrichSchema = z.object({
  status: z.string().optional(),
  blockedReason: z.string().optional(),
  unresolvedQuestions: z.array(z.object({
    question: z.string(),
    owner: z.string(),
  })).optional(),
}).passthrough();

const ValidateEnrichSchema = z.object({
  score: z.number().optional(),
  findings: z.array(z.object({
    category: z.string(),
    severity: z.string(),
    description: z.string(),
  })).optional(),
}).passthrough();

/**
 * Load saved stage artifacts to extract open questions, findings, and score.
 * This reads from disk — the same artifacts the orchestrator already persisted.
 */
function enrichFromArtifacts(result: WorkflowResult): {
  score?: number;
  openQuestions?: Array<{ question: string; owner: string }>;
  findings?: Array<{ category: string; severity: string; description: string }>;
  blockReason?: string;
} {
  const enriched: ReturnType<typeof enrichFromArtifacts> = {};

  // Extract open questions from decompose artifact
  const decompose = loadTypedArtifact(result.workflowId, "decompose", DecomposeEnrichSchema);
  if (decompose) {
    if (decompose.status === "blocked" && decompose.blockedReason) {
      enriched.blockReason = decompose.blockedReason;
    }
    if (decompose.unresolvedQuestions && decompose.unresolvedQuestions.length > 0) {
      enriched.openQuestions = decompose.unresolvedQuestions;
    }
  }

  // Extract score and findings from validate artifact
  const validate = loadTypedArtifact(result.workflowId, "validate", ValidateEnrichSchema);
  if (validate) {
    if (validate.score !== undefined) {
      enriched.score = validate.score;
    }
    if (validate.findings && validate.findings.length > 0) {
      enriched.findings = validate.findings;
    }
  }

  return enriched;
}
