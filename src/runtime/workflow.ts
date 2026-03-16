import * as crypto from "crypto";
import { runCapability, RunResult, RunMetadata } from "./runCapability";
import { LLMAdapter } from "./types";
import { saveArtifact } from "../storage/local";
import { executePatch } from "./executePatch";
import { dryRunValidate, PatchInput } from "../patch/dryRun";
import { defaultSafetyConfig } from "../patch/safetyChecks";
import { gitApplyPatches, GitApplyResult } from "../patch/gitIntegration";
import { confirmWithPreview, ConfirmationResult } from "../patch/confirmationPreview";

// ── Pipeline definitions ─────────────────────────────────────────────

const SAFE_PIPELINE: StageDefinition[] = [
  { capabilityId: "intake",    outputKey: "intake" },
  { capabilityId: "design",    outputKey: "design" },
  { capabilityId: "decompose", outputKey: "decompose" },
  { capabilityId: "execute",   outputKey: "execute" },
  { capabilityId: "validate",  outputKey: "validate" },
];

const MUTATION_PIPELINE: StageDefinition[] = [
  { capabilityId: "intake",         outputKey: "intake" },
  { capabilityId: "design",         outputKey: "design" },
  { capabilityId: "decompose",      outputKey: "decompose" },
  { capabilityId: "execute-patch",  outputKey: "execute-patch" },
  { capabilityId: "dry-run",        outputKey: "dry-run" },
  { capabilityId: "apply",          outputKey: "apply" },
  { capabilityId: "validate",       outputKey: "validate" },
];

interface StageDefinition {
  capabilityId: string;
  outputKey: string;
}

// ── Workflow types ───────────────────────────────────────────────────

export type StageStatus = "passed" | "failed" | "blocked" | "skipped";

export interface StageResult {
  capabilityId: string;
  capabilityVersion: string;
  status: StageStatus;
  runResult?: RunResult;
  durationMs: number;
  blockReason?: string;
  validationErrors?: string[];
}

export interface MutationResult {
  enabled: boolean;
  patchGenerated: boolean;
  dryRunPassed: boolean;
  previewShown: boolean;
  applyConfirmed: boolean;
  /** How confirmation was obtained: "flag", "interactive", or "declined" */
  confirmationSource: "flag" | "interactive" | "declined" | "none";
  applied: boolean;
  branchName: string;
  commitHash: string;
  filesChanged: string[];
  rollbackTriggered: boolean;
  errors: string[];
}

export interface WorkflowResult {
  workflowId: string;
  timestamp: string;
  executionMode: "safe" | "mutation";
  adapter: { adapterId: string; modelId: string; transport: string };
  stages: StageResult[];
  mutation?: MutationResult;
  finalVerdict: "pass" | "fail" | "blocked" | "inconclusive";
  totalDurationMs: number;
  summary: string;
}

export interface WorkflowOptions {
  llm: LLMAdapter;
  quiet?: boolean;
  /** Enable mutation mode (execute-patch → dry-run → apply → git) */
  apply?: boolean;
  /** Explicit confirmation for mutation — required alongside apply */
  confirmApply?: boolean;
  /** Enable interactive confirmation prompt (show preview + ask user) */
  interactive?: boolean;
  /** Repo root for patch generation and application */
  repoRoot?: string;
  /** Additional file hints for repo context */
  fileHints?: string[];
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runWorkflow(
  request: unknown,
  options: WorkflowOptions,
): Promise<WorkflowResult> {
  const workflowId = `wf_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const { llm, quiet, apply, confirmApply, interactive, repoRoot, fileHints } = options;
  const log = quiet ? (() => {}) : console.log.bind(console);
  const mutationMode = !!apply;

  const pipeline = mutationMode ? MUTATION_PIPELINE : SAFE_PIPELINE;
  const workflowStart = Date.now();
  const stages: StageResult[] = [];
  let currentInput: unknown = request;
  let blocked = false;
  let blockReason = "";
  let decomposeBlocked = false;

  // Mutation tracking
  const mutation: MutationResult = {
    enabled: mutationMode,
    patchGenerated: false,
    dryRunPassed: false,
    previewShown: false,
    applyConfirmed: !!confirmApply,
    confirmationSource: confirmApply ? "flag" : "none",
    applied: false,
    branchName: "",
    commitHash: "",
    filesChanged: [],
    rollbackTriggered: false,
    errors: [],
  };

  // State for mutation stages
  let patchArtifact: Record<string, unknown> | null = null;
  let gitResult: GitApplyResult | null = null;
  let savedDryRunResult: Record<string, unknown> | null = null;
  let savedApplyResult: Record<string, unknown> | null = null;

  const modeLabel = mutationMode ? "MUTATION" : "SAFE";
  log(`\n[Workflow] ${workflowId}`);
  log(`[Workflow] Mode: ${modeLabel}`);
  log(`[Workflow] Adapter: ${llm.adapterInfo.adapterId} (${llm.adapterInfo.transport})`);
  log(`[Workflow] Model: ${llm.adapterInfo.modelId}`);
  log(`[Workflow] Pipeline: ${pipeline.map((s) => s.capabilityId).join(" → ")}\n`);

  if (mutationMode && !repoRoot) {
    log(`  [!!] Mutation mode requires --repo-root. Falling back to safe mode.\n`);
    mutation.errors.push("Mutation mode requires repoRoot");
  }

  for (const stage of pipeline) {
    const stageStart = Date.now();

    // ── Skip downstream stages if blocked ──
    if (blocked) {
      stages.push({
        capabilityId: stage.capabilityId,
        capabilityVersion: "-",
        status: "skipped",
        durationMs: 0,
        blockReason: `Skipped — upstream blocked: ${blockReason}`,
      });
      log(`  ${stage.capabilityId.padEnd(16)} SKIPPED (upstream blocked)`);
      continue;
    }

    // ── Mutation-mode special stages ──

    if (stage.capabilityId === "execute-patch") {
      log(`  ${stage.capabilityId.padEnd(16)} running...`);

      // Skip if decompose was blocked
      if (decomposeBlocked) {
        // Pass blocked plan forward to validate directly
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "skipped",
          durationMs: 0,
          blockReason: "Decompose was blocked — skipping patch generation",
        });
        log(`  ${stage.capabilityId.padEnd(16)} SKIPPED (decompose blocked)`);
        continue;
      }

      if (!repoRoot) {
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "failed",
          durationMs: 0,
          validationErrors: ["repoRoot not provided for mutation mode"],
        });
        blocked = true;
        blockReason = "execute-patch requires repoRoot";
        log(`  ${stage.capabilityId.padEnd(16)} FAILED  (no repoRoot)`);
        continue;
      }

      try {
        const planInput = currentInput as Record<string, unknown>;
        const result = await executePatch(planInput, {
          llm,
          repoRoot,
          fileHints,
          runId: workflowId,
          quiet: true,
        });

        const durationMs = Date.now() - stageStart;
        saveArtifact(workflowId, `${stage.capabilityId}.lineage`, {
          workflowId, capabilityId: stage.capabilityId,
          capabilityVersion: result.version,
          parentArtifact: "decompose",
          timestamp: new Date().toISOString(),
          validated: result.validated,
        });

        if (!result.validated) {
          stages.push({
            capabilityId: stage.capabilityId,
            capabilityVersion: result.version,
            status: "failed",
            runResult: result,
            durationMs,
            validationErrors: result.validationErrors,
          });
          blocked = true;
          blockReason = "execute-patch failed schema validation";
          log(`  ${stage.capabilityId.padEnd(16)} FAILED  (${durationMs}ms) — schema validation`);
          continue;
        }

        patchArtifact = result.output as Record<string, unknown>;
        const patchStatus = patchArtifact.executionStatus as string;
        mutation.patchGenerated = true;

        if (patchStatus === "blocked" || patchStatus === "insufficient_context") {
          stages.push({
            capabilityId: stage.capabilityId,
            capabilityVersion: result.version,
            status: "blocked",
            runResult: result,
            durationMs,
            blockReason: (patchArtifact.blockedReason as string)
              || (patchArtifact.missingContext as string[] || []).join("; ")
              || `Patch generation ${patchStatus}`,
          });
          log(`  ${stage.capabilityId.padEnd(16)} BLOCKED (${durationMs}ms) — ${patchStatus}`);
          currentInput = result.output;
          continue;
        }

        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: result.version,
          status: "passed",
          runResult: result,
          durationMs,
        });
        log(`  ${stage.capabilityId.padEnd(16)} PASSED  (${durationMs}ms)`);
        currentInput = result.output;
        continue;

      } catch (err) {
        const durationMs = Date.now() - stageStart;
        const message = err instanceof Error ? err.message : String(err);
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "0.1.0",
          status: "failed",
          durationMs,
          validationErrors: [message.split("\n")[0]],
        });
        blocked = true;
        blockReason = `execute-patch threw: ${message.split("\n")[0]}`;
        log(`  ${stage.capabilityId.padEnd(16)} ERROR   (${durationMs}ms)`);
        continue;
      }
    }

    if (stage.capabilityId === "dry-run") {
      const durationStart = Date.now();
      log(`  ${stage.capabilityId.padEnd(16)} running...`);

      // Skip if no patch artifact or decompose blocked
      if (!patchArtifact || decomposeBlocked) {
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "skipped",
          durationMs: 0,
          blockReason: "No patch artifact to validate",
        });
        log(`  ${stage.capabilityId.padEnd(16)} SKIPPED (no patches)`);
        continue;
      }

      const patches = (patchArtifact.patches as Array<{ filePath: string; operation: "create" | "modify" | "delete"; diff: string }>) || [];
      if (patches.length === 0) {
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "skipped",
          durationMs: 0,
          blockReason: "Patch artifact has no patches",
        });
        log(`  ${stage.capabilityId.padEnd(16)} SKIPPED (0 patches)`);
        continue;
      }

      const patchInputs: PatchInput[] = patches.map((p) => ({
        filePath: p.filePath,
        operation: p.operation,
        diff: p.diff,
      }));

      const safetyConfig = defaultSafetyConfig(repoRoot!);
      const dryRunResult = dryRunValidate(patchInputs, safetyConfig);
      const durationMs = Date.now() - durationStart;

      saveArtifact(workflowId, "dry-run", dryRunResult);
      savedDryRunResult = {
        safe: dryRunResult.safe,
        applicable: dryRunResult.applicable,
        conflicts: dryRunResult.conflicts,
        errors: dryRunResult.errors,
        summary: dryRunResult.summary,
        patchResults: dryRunResult.patchChecks.map((pc) => ({
          filePath: pc.filePath,
          operation: pc.operation,
          status: pc.status,
          detail: pc.detail,
        })),
        safetyViolations: dryRunResult.safetyViolations,
      };

      if (!dryRunResult.safe || dryRunResult.applicable === 0) {
        const reason = !dryRunResult.safe
          ? `Safety violations: ${dryRunResult.safetyViolations.map((v) => v.detail).join("; ")}`
          : `No applicable patches: ${dryRunResult.summary}`;

        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "failed",
          durationMs,
          blockReason: reason,
        });
        blocked = true;
        blockReason = `dry-run failed: ${reason}`;
        mutation.errors.push(reason);
        log(`  ${stage.capabilityId.padEnd(16)} FAILED  (${durationMs}ms) — ${dryRunResult.summary}`);
        continue;
      }

      mutation.dryRunPassed = true;
      stages.push({
        capabilityId: stage.capabilityId,
        capabilityVersion: "-",
        status: "passed",
        durationMs,
      });
      log(`  ${stage.capabilityId.padEnd(16)} PASSED  (${durationMs}ms) — ${dryRunResult.summary}`);
      continue;
    }

    if (stage.capabilityId === "apply") {
      const durationStart = Date.now();
      log(`  ${stage.capabilityId.padEnd(16)} running...`);

      // Guard: no patch artifact
      if (!patchArtifact) {
        const durationMs = Date.now() - durationStart;
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "failed",
          durationMs,
          blockReason: "No patch artifact available for apply",
        });
        blocked = true;
        blockReason = "apply: no patch artifact";
        mutation.errors.push("No patch artifact available");
        log(`  ${stage.capabilityId.padEnd(16)} FAILED  (${durationMs}ms) — no patch artifact`);
        continue;
      }

      const patches = (patchArtifact.patches as Array<{ filePath: string; operation: "create" | "modify" | "delete"; diff: string }>) || [];
      const patchInputs: PatchInput[] = patches.map((p) => ({
        filePath: p.filePath,
        operation: p.operation,
        diff: p.diff,
      }));

      const safetyConfig = defaultSafetyConfig(repoRoot!);
      const dryRunResult = dryRunValidate(patchInputs, safetyConfig);

      // ── Preview + Confirmation ──
      // Show preview whenever we have applicable patches and are not in quiet mode.
      // Resolve confirmation via: --confirm-apply (flag), --interactive (prompt), or decline.
      const hasConfirmation = !!confirmApply || !!interactive;

      if (!hasConfirmation) {
        // No confirmation mechanism — show preview as dry-run report, block apply
        if (!quiet) {
          const { renderPreview } = await import("../patch/confirmationPreview");
          const preview = renderPreview({
            runId: workflowId,
            repoRoot: repoRoot!,
            patches: patchInputs,
            dryRunResult,
            planTitle: patchArtifact.planTitle as string | undefined,
          });
          log(preview);
        }
        mutation.previewShown = !quiet;

        const durationMs = Date.now() - durationStart;
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "blocked",
          durationMs,
          blockReason: "Apply requires --confirm-apply or --interactive flag",
        });
        mutation.errors.push("Confirmation not provided (--confirm-apply or --interactive)");
        mutation.confirmationSource = "none";
        log(`  ${stage.capabilityId.padEnd(16)} BLOCKED (${durationMs}ms) — no confirmation`);
        // Don't set blocked=true — let validate still run to assess the patches
        currentInput = patchArtifact;
        continue;
      }

      // Run confirmation flow (preview + optional prompt)
      const confirmation = await confirmWithPreview(
        {
          runId: workflowId,
          repoRoot: repoRoot!,
          patches: patchInputs,
          dryRunResult,
          planTitle: patchArtifact.planTitle as string | undefined,
        },
        {
          confirmApply: !!confirmApply,
          interactive: !!interactive && !confirmApply, // Don't prompt if --confirm-apply already given
          log,
        },
      );

      mutation.previewShown = confirmation.previewShown;
      mutation.applyConfirmed = confirmation.confirmed;
      mutation.confirmationSource = confirmation.source;

      // Save confirmation result
      saveArtifact(workflowId, "confirmation", {
        workflowId,
        timestamp: new Date().toISOString(),
        previewShown: confirmation.previewShown,
        confirmed: confirmation.confirmed,
        source: confirmation.source,
      });

      if (!confirmation.confirmed) {
        const durationMs = Date.now() - durationStart;
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "blocked",
          durationMs,
          blockReason: `Apply declined by user (${confirmation.source})`,
        });
        mutation.errors.push(`Apply declined (${confirmation.source})`);
        log(`  ${stage.capabilityId.padEnd(16)} BLOCKED (${durationMs}ms) — user declined`);
        currentInput = patchArtifact;
        continue;
      }

      // ── Apply + Git ──
      gitResult = gitApplyPatches(patchInputs, {
        repoRoot: repoRoot!,
        confirmed: true,
        dryRunResult,
        runId: workflowId,
        planTitle: patchArtifact.planTitle as string,
        patchArtifactRef: `${workflowId}/execute-patch.json`,
        changeSummary: patchArtifact.changeSummary as string,
      });

      const durationMs = Date.now() - durationStart;

      // Store for mutation-aware validation
      savedApplyResult = {
        status: gitResult.applyResult.status,
        filesChanged: gitResult.applyResult.filesChanged,
        fileResults: gitResult.applyResult.fileResults,
        errors: gitResult.applyResult.errors,
        rollback: gitResult.applyResult.rollback,
      };

      // Persist apply result
      saveArtifact(workflowId, "apply", {
        applyId: gitResult.applyResult.applyId,
        timestamp: gitResult.applyResult.timestamp,
        status: gitResult.applyResult.status,
        filesChanged: gitResult.applyResult.filesChanged,
        fileResults: gitResult.applyResult.fileResults,
        rollback: gitResult.applyResult.rollback,
        errors: gitResult.applyResult.errors,
        git: gitResult.git,
      });

      if (gitResult.applyResult.status === "applied" || gitResult.applyResult.status === "partial") {
        mutation.applied = true;
        mutation.branchName = gitResult.git.branchName;
        mutation.commitHash = gitResult.git.commitHash;
        mutation.filesChanged = gitResult.git.filesStaged;

        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "passed",
          durationMs,
        });
        log(`  ${stage.capabilityId.padEnd(16)} PASSED  (${durationMs}ms) — ${gitResult.git.filesStaged.length} files, branch: ${gitResult.git.branchName}`);
      } else {
        mutation.rollbackTriggered = gitResult.applyResult.rollback.triggered;
        mutation.errors.push(...gitResult.applyResult.errors);

        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: "-",
          status: "failed",
          durationMs,
          blockReason: `Apply ${gitResult.applyResult.status}: ${gitResult.applyResult.errors.join("; ")}`,
        });
        blocked = true;
        blockReason = `apply failed: ${gitResult.applyResult.status}`;
        log(`  ${stage.capabilityId.padEnd(16)} FAILED  (${durationMs}ms) — ${gitResult.applyResult.status}`);
      }
      continue;
    }

    // ── Standard capability stages (intake, design, decompose, execute, validate) ──

    // Augment validate input with mutation context when in mutation mode
    if (stage.capabilityId === "validate" && mutationMode && patchArtifact) {
      currentInput = {
        execution: currentInput,
        mutationContext: {
          mode: "mutation",
          confirmed: !!confirmApply,
          dryRun: savedDryRunResult,
          apply: savedApplyResult,
          git: gitResult ? {
            branchCreated: gitResult.git.branchCreated,
            branchName: gitResult.git.branchName,
            commitCreated: gitResult.git.commitCreated,
            commitHash: gitResult.git.commitHash,
            filesStaged: gitResult.git.filesStaged,
          } : null,
        },
      };
    }

    log(`  ${stage.capabilityId.padEnd(16)} running...`);

    try {
      const result = await runCapability(stage.capabilityId, currentInput, {
        llm,
        runId: workflowId,
        quiet: true,
      });

      const durationMs = Date.now() - stageStart;

      saveArtifact(workflowId, `${stage.capabilityId}.lineage`, {
        workflowId,
        capabilityId: stage.capabilityId,
        capabilityVersion: result.version,
        parentArtifact: stages.length > 0 ? stages[stages.length - 1].capabilityId : "request",
        timestamp: new Date().toISOString(),
        validated: result.validated,
      });

      if (!result.validated) {
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: result.version,
          status: "failed",
          runResult: result,
          durationMs,
          validationErrors: result.validationErrors,
        });
        blocked = true;
        blockReason = `${stage.capabilityId} failed schema validation`;
        log(`  ${stage.capabilityId.padEnd(16)} FAILED  (${durationMs}ms) — schema validation`);
        continue;
      }

      const output = result.output as Record<string, unknown>;
      const outputStatus = output.status as string | undefined;

      if (stage.capabilityId === "decompose" && outputStatus === "blocked") {
        decomposeBlocked = true;
        stages.push({
          capabilityId: stage.capabilityId,
          capabilityVersion: result.version,
          status: "blocked",
          runResult: result,
          durationMs,
          blockReason: (output.blockedReason as string) || "Decompose returned blocked status",
        });
        log(`  ${stage.capabilityId.padEnd(16)} BLOCKED (${durationMs}ms)`);
        currentInput = result.output;
        continue;
      }

      stages.push({
        capabilityId: stage.capabilityId,
        capabilityVersion: result.version,
        status: "passed",
        runResult: result,
        durationMs,
      });
      log(`  ${stage.capabilityId.padEnd(16)} PASSED  (${durationMs}ms)`);
      currentInput = result.output;

    } catch (err) {
      const durationMs = Date.now() - stageStart;
      const message = err instanceof Error ? err.message : String(err);
      stages.push({
        capabilityId: stage.capabilityId,
        capabilityVersion: "0.1.0",
        status: "failed",
        durationMs,
        validationErrors: [message.split("\n")[0]],
      });
      blocked = true;
      blockReason = `${stage.capabilityId} threw: ${message.split("\n")[0]}`;
      log(`  ${stage.capabilityId.padEnd(16)} ERROR   (${durationMs}ms)`);
    }
  }

  const totalDurationMs = Date.now() - workflowStart;
  const finalVerdict = determineFinalVerdict(stages);
  const summary = buildSummary(stages, finalVerdict, mutationMode ? mutation : undefined);

  const workflowResult: WorkflowResult = {
    workflowId,
    timestamp: new Date().toISOString(),
    executionMode: mutationMode ? "mutation" : "safe",
    adapter: llm.adapterInfo,
    stages: stages.map((s) => ({
      capabilityId: s.capabilityId,
      capabilityVersion: s.capabilityVersion,
      status: s.status,
      durationMs: s.durationMs,
      blockReason: s.blockReason,
      validationErrors: s.validationErrors,
    })),
    mutation: mutationMode ? mutation : undefined,
    finalVerdict,
    totalDurationMs,
    summary,
  };

  saveArtifact(workflowId, "workflow", workflowResult);
  return workflowResult;
}

// ── Verdict logic ────────────────────────────────────────────────────

function determineFinalVerdict(stages: StageResult[]): WorkflowResult["finalVerdict"] {
  const validateStage = stages.find((s) => s.capabilityId === "validate");
  const hasFailure = stages.some((s) => s.status === "failed");
  const hasBlocked = stages.some((s) => s.status === "blocked");

  if (validateStage?.runResult?.validated) {
    const evalOutput = validateStage.runResult.output as Record<string, unknown>;
    const evalVerdict = evalOutput.verdict as string;
    if (evalVerdict === "pass") return "pass";
    if (evalVerdict === "fail") return "fail";
    return "inconclusive";
  }

  if (hasFailure) return "fail";
  if (hasBlocked) return "blocked";
  return "inconclusive";
}

// ── Summary renderer ─────────────────────────────────────────────────

function buildSummary(
  stages: StageResult[],
  verdict: WorkflowResult["finalVerdict"],
  mutation?: MutationResult,
): string {
  const lines: string[] = [];

  const blockedStage = stages.find((s) => s.status === "blocked");
  const failedStage = stages.find((s) => s.status === "failed");
  const validateStage = stages.find((s) => s.capabilityId === "validate");

  if (verdict === "pass") {
    lines.push("Workflow completed successfully — all stages passed and validate returned pass.");
  } else if (verdict === "blocked") {
    lines.push(`Workflow blocked at ${blockedStage?.capabilityId}: ${blockedStage?.blockReason}`);
  } else if (verdict === "fail" && failedStage) {
    const errors = failedStage.validationErrors?.join("; ") || "unknown error";
    lines.push(`Workflow failed at ${failedStage.capabilityId}: ${errors}`);
  } else {
    lines.push("Workflow completed with inconclusive verdict.");
  }

  if (validateStage?.runResult?.validated) {
    const evalOutput = validateStage.runResult.output as Record<string, unknown>;
    const score = evalOutput.score as number | undefined;
    if (score !== undefined) lines.push(`Validate score: ${score}/100.`);
    const findings = evalOutput.findings as Array<{ category: string; severity: string; description: string }> | undefined;
    if (findings && findings.length > 0) {
      const critical = findings.filter((f) => f.severity === "critical");
      const major = findings.filter((f) => f.severity === "major");
      if (critical.length > 0) lines.push(`Critical findings: ${critical.map((f) => f.description).join("; ")}`);
      if (major.length > 0) lines.push(`Major findings: ${major.map((f) => f.description).join("; ")}`);
    }
  }

  if (mutation?.applied) {
    lines.push(`Applied to branch: ${mutation.branchName} (${mutation.commitHash.substring(0, 8)})`);
  }

  return lines.join(" ");
}

// ── CLI summary renderer ─────────────────────────────────────────────

export function renderWorkflowSummary(result: WorkflowResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════╗");
  lines.push(`║         WORKFLOW SUMMARY (${result.executionMode.toUpperCase().padEnd(8)})     ║`);
  lines.push("╚══════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Workflow ID: ${result.workflowId}`);
  lines.push(`  Mode:        ${result.executionMode}`);
  lines.push(`  Duration:    ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`  Adapter:     ${result.adapter.adapterId} / ${result.adapter.modelId}`);
  lines.push("");
  lines.push("  Stage Results:");
  lines.push("  ─────────────────────────────────────────");

  for (const stage of result.stages) {
    const icon = stageIcon(stage.status);
    const dur = stage.durationMs > 0 ? `${(stage.durationMs / 1000).toFixed(1)}s` : "—";
    let line = `  ${icon} ${stage.capabilityId.padEnd(16)} ${stage.status.padEnd(8)} ${dur}`;
    if (stage.blockReason && (stage.status === "blocked" || stage.status === "failed")) {
      line += `  (${truncate(stage.blockReason, 50)})`;
    }
    lines.push(line);
  }

  // Mutation details
  if (result.mutation?.enabled) {
    lines.push("");
    lines.push("  Mutation Details:");
    lines.push("  ─────────────────────────────────────────");
    const m = result.mutation;
    lines.push(`  Patch generated:  ${m.patchGenerated ? "yes" : "no"}`);
    lines.push(`  Dry-run passed:   ${m.dryRunPassed ? "yes" : "no"}`);
    lines.push(`  Preview shown:    ${m.previewShown ? "yes" : "no"}`);
    lines.push(`  Confirmed:        ${m.applyConfirmed ? "yes" : "no"} (${m.confirmationSource})`);
    lines.push(`  Applied:          ${m.applied ? "yes" : "no"}`);
    if (m.branchName) lines.push(`  Branch:           ${m.branchName}`);
    if (m.commitHash) lines.push(`  Commit:           ${m.commitHash.substring(0, 12)}`);
    if (m.filesChanged.length > 0) {
      lines.push(`  Files changed:    ${m.filesChanged.length}`);
      for (const f of m.filesChanged) {
        lines.push(`    - ${f}`);
      }
    }
    if (m.rollbackTriggered) lines.push(`  Rollback:         triggered`);
    if (m.errors.length > 0) {
      lines.push(`  Errors:`);
      for (const e of m.errors) {
        lines.push(`    - ${truncate(e, 70)}`);
      }
    }
  }

  // Mutation assessment from validate (if present)
  const validateStage = result.stages.find((s) => s.capabilityId === "validate");
  if (validateStage?.runResult?.validated) {
    const evalOutput = validateStage.runResult.output as Record<string, unknown>;
    const ma = evalOutput.mutationAssessment as {
      patchGrounding?: { score: number };
      applyIntegrity?: { score: number };
      gitTraceability?: { score: number };
      workflowConsistency?: { score: number };
      mutationCorrect?: boolean;
      mutationSummary?: string;
    } | undefined;

    if (ma) {
      lines.push("");
      lines.push("  Mutation Assessment:");
      lines.push("  ─────────────────────────────────────────");
      if (ma.patchGrounding) lines.push(`  Patch Grounding:      ${ma.patchGrounding.score}/100`);
      if (ma.applyIntegrity) lines.push(`  Apply Integrity:      ${ma.applyIntegrity.score}/100`);
      if (ma.gitTraceability) lines.push(`  Git Traceability:     ${ma.gitTraceability.score}/100`);
      if (ma.workflowConsistency) lines.push(`  Workflow Consistency: ${ma.workflowConsistency.score}/100`);
      lines.push(`  Mutation Correct:     ${ma.mutationCorrect ? "yes" : "no"}`);
      if (ma.mutationSummary) lines.push(`  ${truncate(ma.mutationSummary, 70)}`);
    }

    // Surface mutation-specific findings
    const findings = evalOutput.findings as Array<{ category: string; severity: string; description: string }> | undefined;
    if (findings && findings.length > 0) {
      const mutationFindings = findings.filter((f) =>
        ["patch_grounding", "apply_integrity", "git_traceability", "workflow_inconsistency"].includes(f.category)
      );
      if (mutationFindings.length > 0) {
        lines.push("");
        lines.push("  Mutation Findings:");
        for (const f of mutationFindings) {
          lines.push(`    [${f.severity}] ${f.category}: ${truncate(f.description, 60)}`);
        }
      }
    }
  }

  lines.push("");
  lines.push("  ─────────────────────────────────────────");
  lines.push(`  Final Verdict: ${verdictLabel(result.finalVerdict)}`);

  if (result.summary) {
    lines.push("");
    const words = result.summary.split(" ");
    let current = "  ";
    for (const word of words) {
      if (current.length + word.length > 72) {
        lines.push(current);
        current = "  " + word;
      } else {
        current += (current.length > 2 ? " " : "") + word;
      }
    }
    if (current.length > 2) lines.push(current);
  }

  lines.push("");
  return lines.join("\n");
}

function stageIcon(status: StageStatus): string {
  switch (status) {
    case "passed": return "[OK]";
    case "failed": return "[!!]";
    case "blocked": return "[--]";
    case "skipped": return "[..]";
  }
}

function verdictLabel(verdict: WorkflowResult["finalVerdict"]): string {
  switch (verdict) {
    case "pass": return "PASS";
    case "fail": return "FAIL";
    case "blocked": return "BLOCKED";
    case "inconclusive": return "INCONCLUSIVE";
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + "..." : s;
}
