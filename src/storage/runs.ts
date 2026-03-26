/**
 * Run inspection helpers.
 *
 * Loads and summarises completed workflow runs from the artifacts directory.
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { loadArtifact, loadTypedArtifact } from "./local";

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");

// Lightweight schemas for safe artifact reading (subset of full schemas)
const WorkflowArtifactSchema = z.object({
  workflowId: z.string(),
  timestamp: z.string(),
  executionMode: z.enum(["safe", "mutation"]),
  adapter: z.object({ adapterId: z.string(), modelId: z.string(), transport: z.string() }),
  finalVerdict: z.string(),
  totalDurationMs: z.number(),
  summary: z.string(),
  stages: z.array(z.object({
    capabilityId: z.string(),
    status: z.string(),
    durationMs: z.number(),
    blockReason: z.string().optional(),
  })),
  mutation: z.object({
    applied: z.boolean(),
    branchName: z.string(),
    commitHash: z.string(),
    filesChanged: z.array(z.string()),
    patchGenerated: z.boolean(),
    dryRunPassed: z.boolean(),
    confirmationSource: z.string(),
    rollbackTriggered: z.boolean(),
    errors: z.array(z.string()),
  }).optional(),
});

const IntakeReadSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  problem_statement: z.string().optional(),
}).passthrough();

const ValidateReadSchema = z.object({
  score: z.number().optional(),
  findings: z.array(z.object({
    category: z.string(),
    severity: z.string(),
    description: z.string(),
  })).optional(),
}).passthrough();

const DecomposeReadSchema = z.object({
  status: z.string().optional(),
  blockedReason: z.string().optional(),
  unresolvedQuestions: z.array(z.object({
    question: z.string(),
    owner: z.string(),
  })).optional(),
}).passthrough();

export interface RunSummary {
  workflowId: string;
  timestamp: string;
  executionMode: "safe" | "mutation";
  adapter: { adapterId: string; modelId: string; transport: string };
  finalVerdict: string;
  totalDurationMs: number;
  summary: string;

  // From workflow.json stages
  stages: Array<{
    capabilityId: string;
    status: string;
    durationMs: number;
    blockReason?: string;
  }>;

  // Enriched from artifacts
  score?: number;
  findings?: Array<{ category: string; severity: string; description: string }>;
  openQuestions?: Array<{ question: string; owner: string }>;
  blockReason?: string;
  originalRequest?: string;

  // Mutation data
  mutation?: {
    applied: boolean;
    branchName: string;
    commitHash: string;
    filesChanged: string[];
    patchGenerated: boolean;
    dryRunPassed: boolean;
    confirmationSource: string;
    rollbackTriggered: boolean;
    errors: string[];
  };

  // Artifact paths on disk
  artifactPaths: string[];
}

export function loadRun(runId: string): RunSummary | null {
  const runDir = path.join(ARTIFACTS_DIR, runId);
  if (!fs.existsSync(runDir)) return null;

  const workflow = loadTypedArtifact(runId, "workflow", WorkflowArtifactSchema);
  if (!workflow) return null;

  // List all artifact files
  const artifactPaths = fs.readdirSync(runDir)
    .filter((f) => f.endsWith(".json") || f.endsWith(".txt"))
    .map((f) => path.join(runDir, f));

  // Extract original request from intake
  const intake = loadTypedArtifact(runId, "intake", IntakeReadSchema);
  const originalRequest = intake?.title
    || intake?.body
    || workflow.summary.substring(0, 120);

  // Extract score + findings from validate
  const validate = loadTypedArtifact(runId, "validate", ValidateReadSchema);

  // Extract block reason + questions from decompose
  const decompose = loadTypedArtifact(runId, "decompose", DecomposeReadSchema);
  const blockReason = decompose?.status === "blocked"
    ? decompose.blockedReason
    : undefined;

  return {
    workflowId: workflow.workflowId,
    timestamp: workflow.timestamp,
    executionMode: workflow.executionMode,
    adapter: workflow.adapter,
    finalVerdict: workflow.finalVerdict,
    totalDurationMs: workflow.totalDurationMs,
    summary: workflow.summary,
    stages: workflow.stages,
    score: validate?.score,
    findings: validate?.findings,
    openQuestions: decompose?.unresolvedQuestions,
    blockReason,
    originalRequest,
    mutation: workflow.mutation,
    artifactPaths,
  };
}

export function listRuns(): string[] {
  if (!fs.existsSync(ARTIFACTS_DIR)) return [];
  return fs.readdirSync(ARTIFACTS_DIR)
    .filter((d) => d.startsWith("wf_") && fs.statSync(path.join(ARTIFACTS_DIR, d)).isDirectory())
    .sort()
    .reverse();
}

export function resolveRunId(partial: string): string | null {
  if (!fs.existsSync(ARTIFACTS_DIR)) return null;

  // Exact match
  const exact = path.join(ARTIFACTS_DIR, partial);
  if (fs.existsSync(exact)) return partial;

  // Partial match (suffix)
  const all = listRuns();
  const matches = all.filter((r) => r.includes(partial));
  return matches.length === 1 ? matches[0] : null;
}
