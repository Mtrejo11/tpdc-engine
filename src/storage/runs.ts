/**
 * Run inspection helpers.
 *
 * Loads and summarises completed workflow runs from the artifacts directory.
 */

import * as fs from "fs";
import * as path from "path";
import { loadArtifact } from "./local";

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");

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

  const workflow = loadArtifact(runId, "workflow") as Record<string, unknown> | null;
  if (!workflow) return null;

  // List all artifact files
  const artifactPaths = fs.readdirSync(runDir)
    .filter((f) => f.endsWith(".json") || f.endsWith(".txt"))
    .map((f) => path.join(runDir, f));

  // Extract original request from intake
  const intake = loadArtifact(runId, "intake") as Record<string, unknown> | null;
  const originalRequest = intake?.title as string | undefined
    || intake?.body as string | undefined
    || (workflow.summary as string || "").substring(0, 120);

  // Extract score + findings from validate
  const validate = loadArtifact(runId, "validate") as Record<string, unknown> | null;
  const score = validate?.score as number | undefined;
  const findings = validate?.findings as RunSummary["findings"] | undefined;

  // Extract block reason + questions from decompose
  const decompose = loadArtifact(runId, "decompose") as Record<string, unknown> | null;
  const blockReason = decompose?.status === "blocked"
    ? decompose.blockedReason as string
    : undefined;
  const openQuestions = decompose?.unresolvedQuestions as RunSummary["openQuestions"] | undefined;

  // Mutation data
  const mutation = workflow.mutation as RunSummary["mutation"] | undefined;

  return {
    workflowId: workflow.workflowId as string,
    timestamp: workflow.timestamp as string,
    executionMode: workflow.executionMode as "safe" | "mutation",
    adapter: workflow.adapter as RunSummary["adapter"],
    finalVerdict: workflow.finalVerdict as string,
    totalDurationMs: workflow.totalDurationMs as number,
    summary: workflow.summary as string,
    stages: (workflow.stages as RunSummary["stages"]) || [],
    score,
    findings,
    openQuestions,
    blockReason,
    originalRequest,
    mutation: mutation?.applied !== undefined ? mutation : undefined,
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
