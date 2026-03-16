/**
 * Command dispatcher for TPDC invocations.
 *
 * Maps parsed commands to existing engine functions.
 * Returns structured results suitable for Claude-facing rendering.
 */

import * as fs from "fs";
import * as path from "path";
import { ParsedInvocation, TpdcCommand, parseDevelopArgs } from "./parser";
import { runDevelop } from "./develop";
import { runWorkflow, WorkflowResult } from "../runtime/workflow";
import { LLMAdapter } from "../runtime/types";
import { loadRun, listRuns, resolveRunId, RunSummary } from "../storage/runs";
import { saveArtifact } from "../storage/local";
import { saveSummaryMarkdown } from "../storage/summary";
import { extractLearnings, aggregateLearning, injectLessons } from "../learning";

// Normalizers
import { normalizeBugReport } from "../plugin/handlers/bugNormalizer";
import { normalizeAssessment } from "../plugin/handlers/assessNormalizer";
import { normalizeDiscovery } from "../plugin/handlers/discoveryNormalizer";
import { normalizeRefactor } from "../plugin/handlers/refactorNormalizer";
import { normalizePlan } from "../plugin/handlers/planNormalizer";

// Artifact builders
import { buildDiscoveryArtifact } from "../plugin/handlers/discoveryArtifact";
import { buildRefactorArtifact } from "../plugin/handlers/refactorArtifact";
import { buildPlanArtifact } from "../plugin/handlers/planArtifact";

// Renderers
import { renderShow } from "../plugin/renderers/showRenderer";
import { renderDiff } from "../plugin/renderers/diffRenderer";
import { renderBugResult } from "../plugin/renderers/bugRenderer";
import { renderAssessResult } from "../plugin/renderers/assessRenderer";
import { renderDiscoveryResult, renderDiscoveryMarkdown } from "../plugin/renderers/discoveryRenderer";
import { renderRefactorResult } from "../plugin/renderers/refactorRenderer";
import { renderPlanResult, renderPlanMarkdown } from "../plugin/renderers/planRenderer";
import { renderWorkflowSummary } from "../runtime/workflow";

// ── Types ────────────────────────────────────────────────────────────

export interface DispatchResult {
  command: TpdcCommand;
  workflowId?: string;
  output: string;
  verdict?: string;
  score?: number;
  error?: string;
}

export interface DispatchOptions {
  llm: LLMAdapter;
  quiet?: boolean;
}

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");

// ── Dispatcher ───────────────────────────────────────────────────────

export async function dispatch(
  invocation: ParsedInvocation,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const { command, args, flags } = invocation;
  const { llm, quiet } = options;

  switch (command) {
    // ── Orchestrator commands ──

    case "develop": {
      const parsed = parseDevelopArgs(args);
      if (!parsed) {
        return {
          command: "develop",
          output: [
            'Usage: tpdc:develop <mode> "<request>"',
            "",
            "Modes:",
            '  feature  — discovery → plan → solve',
            '  bug      — fix (with context validation)',
            '  refactor — refactor',
            "",
            "Examples:",
            '  tpdc:develop feature "Implement tenant reset on logout"',
            '  tpdc:develop bug "Camera permission locked after denial on Android"',
            '  tpdc:develop refactor "Split PlantViewModal into smaller components"',
          ].join("\n"),
          error: "Missing or invalid develop mode",
        };
      }

      // Merge flags from develop args with any outer flags
      const mergedFlags = { ...flags, ...parsed.flags };

      const result = await runDevelop(parsed.mode, parsed.request, mergedFlags, options);
      return {
        command: "develop",
        workflowId: result.artifact.runIds[result.artifact.runIds.length - 1],
        output: result.output,
        verdict: result.artifact.validationResult?.verdict,
        score: result.artifact.validationResult?.score,
        error: result.artifact.finalStatus === "failed" ? "Develop flow failed" : undefined,
      };
    }

    // ── Inspection commands (no workflow) ──

    case "show":
      return handleShow(args);

    case "diff":
      return handleDiff(args);

    // ── Workflow commands ──

    case "solve":
      return handleWorkflow(command, args, {
        llm, quiet,
        apply: flags.apply,
        confirmApply: flags.confirmApply,
        interactive: flags.interactive,
        repoRoot: flags.repoRoot,
        normalize: (text) => injectLessons(text, "solve"),
        render: (run) => renderWorkflowSummary(run as unknown as WorkflowResult),
        postProcess: (run) => learnAndSave(run, "solve"),
      });

    case "fix":
      return handleWorkflow(command, args, {
        llm, quiet,
        apply: flags.apply,
        confirmApply: flags.confirmApply,
        interactive: flags.interactive,
        repoRoot: flags.repoRoot,
        normalize: (text) => {
          const bugCtx = normalizeBugReport(text);
          return injectLessons(bugCtx.normalizedRequest, "fix");
        },
        render: (run) => {
          const bugCtx = normalizeBugReport(args);
          return renderBugResult(run, bugCtx);
        },
        postProcess: (run) => learnAndSave(run, "fix"),
      });

    case "refactor":
      return handleWorkflow(command, args, {
        llm, quiet,
        apply: flags.apply,
        confirmApply: flags.confirmApply,
        interactive: flags.interactive,
        repoRoot: flags.repoRoot,
        normalize: (text) => {
          const ctx = normalizeRefactor(text);
          return injectLessons(ctx.normalizedRequest, "refactor");
        },
        render: (run) => {
          const ctx = normalizeRefactor(args);
          const artifact = buildRefactorArtifact(run, args, ctx.category, ctx.targets);
          saveArtifact(run.workflowId, "refactor", artifact);
          return renderRefactorResult(run, artifact);
        },
        postProcess: (run) => learnAndSave(run, "refactor"),
      });

    case "assess":
      return handleWorkflow(command, args, {
        llm, quiet,
        normalize: (text) => {
          const ctx = normalizeAssessment(text);
          return injectLessons(ctx.normalizedRequest, "assess");
        },
        render: (run) => {
          const ctx = normalizeAssessment(args);
          return renderAssessResult(run, ctx);
        },
        postProcess: (run) => learnAndSave(run, "assess"),
      });

    case "plan":
      return handleWorkflow(command, args, {
        llm, quiet,
        normalize: (text) => {
          const ctx = normalizePlan(text);
          return injectLessons(ctx.normalizedRequest, "plan");
        },
        render: (run) => {
          const ctx = normalizePlan(args);
          const artifact = buildPlanArtifact(run, args, ctx.likelyCommand);
          saveArtifact(run.workflowId, "plan", artifact);
          const md = renderPlanMarkdown(artifact, run);
          fs.mkdirSync(path.join(ARTIFACTS_DIR, run.workflowId), { recursive: true });
          fs.writeFileSync(path.join(ARTIFACTS_DIR, run.workflowId, "summary.md"), md, "utf-8");
          return renderPlanResult(run, artifact);
        },
        postProcess: (run) => learnAndSave(run, "plan"),
      });

    case "discovery":
      return handleWorkflow(command, args, {
        llm, quiet,
        normalize: (text) => {
          const ctx = normalizeDiscovery(text);
          return injectLessons(ctx.normalizedRequest, "discovery");
        },
        render: (run) => {
          const ctx = normalizeDiscovery(args);
          const artifact = buildDiscoveryArtifact(run, args, ctx.likelyCommand);
          saveArtifact(run.workflowId, "discovery", artifact);
          const md = renderDiscoveryMarkdown(artifact, run);
          fs.mkdirSync(path.join(ARTIFACTS_DIR, run.workflowId), { recursive: true });
          fs.writeFileSync(path.join(ARTIFACTS_DIR, run.workflowId, "summary.md"), md, "utf-8");
          return renderDiscoveryResult(artifact, run);
        },
        postProcess: (run) => learnAndSave(run, "discovery"),
      });

    default:
      return {
        command,
        output: `Unknown TPDC command: ${command}`,
        error: `Command "${command}" is not supported`,
      };
  }
}

// ── Handlers ─────────────────────────────────────────────────────────

function handleShow(args: string): DispatchResult {
  if (!args) {
    // List recent runs
    const runs = listRuns().slice(0, 10);
    if (runs.length === 0) {
      return { command: "show", output: "No workflow runs found." };
    }

    const lines: string[] = ["", "  Recent runs:", ""];
    for (const id of runs) {
      const run = loadRun(id);
      if (run) {
        const icon = run.finalVerdict === "pass" ? "✓"
          : run.finalVerdict === "fail" ? "✗"
          : run.finalVerdict === "blocked" ? "⊘" : "?";
        const score = run.score !== undefined ? ` (${run.score}/100)` : "";
        const req = run.originalRequest ? ` — ${run.originalRequest.substring(0, 50)}` : "";
        lines.push(`  ${icon} ${id}  ${run.finalVerdict.padEnd(8)}${score}${req}`);
      }
    }
    lines.push("");
    return { command: "show", output: lines.join("\n") };
  }

  const resolvedId = resolveRunId(args);
  if (!resolvedId) {
    return { command: "show", output: `Run not found: ${args}`, error: "Run not found" };
  }

  const run = loadRun(resolvedId);
  if (!run) {
    return { command: "show", output: `Could not load run: ${resolvedId}`, error: "Load failed" };
  }

  return {
    command: "show",
    workflowId: resolvedId,
    output: renderShow(run),
    verdict: run.finalVerdict,
    score: run.score,
  };
}

function handleDiff(args: string): DispatchResult {
  if (!args) {
    return { command: "diff", output: "Usage: tpdc:diff <runId>", error: "Missing runId" };
  }

  const resolvedId = resolveRunId(args);
  if (!resolvedId) {
    return { command: "diff", output: `Run not found: ${args}`, error: "Run not found" };
  }

  const run = loadRun(resolvedId);
  if (!run) {
    return { command: "diff", output: `Could not load run: ${resolvedId}`, error: "Load failed" };
  }

  return {
    command: "diff",
    workflowId: resolvedId,
    output: renderDiff(run),
    verdict: run.finalVerdict,
    score: run.score,
  };
}

interface WorkflowHandlerOptions {
  llm: LLMAdapter;
  quiet?: boolean;
  apply?: boolean;
  confirmApply?: boolean;
  interactive?: boolean;
  repoRoot?: string;
  normalize: (text: string) => string;
  render: (run: RunSummary) => string;
  postProcess: (run: RunSummary) => void;
}

async function handleWorkflow(
  command: TpdcCommand,
  args: string,
  options: WorkflowHandlerOptions,
): Promise<DispatchResult> {
  if (!args) {
    return {
      command,
      output: `Usage: tpdc:${command} "<request>"`,
      error: "Missing request",
    };
  }

  if (options.apply && !options.repoRoot) {
    return {
      command,
      output: "Error: --apply requires --repo-root <path>",
      error: "Missing repo-root",
    };
  }

  const normalizedRequest = options.normalize(args);

  const result = await runWorkflow(normalizedRequest, {
    llm: options.llm,
    quiet: options.quiet ?? true,
    apply: options.apply,
    confirmApply: options.confirmApply,
    interactive: options.interactive,
    repoRoot: options.repoRoot ? path.resolve(options.repoRoot) : undefined,
  });

  const run = loadRun(result.workflowId);
  if (!run) {
    return {
      command,
      workflowId: result.workflowId,
      output: renderWorkflowSummary(result),
      verdict: result.finalVerdict,
    };
  }

  // Post-process (save summary, extract learnings)
  options.postProcess(run);

  return {
    command,
    workflowId: result.workflowId,
    output: options.render(run),
    verdict: run.finalVerdict,
    score: run.score,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function learnAndSave(run: RunSummary, command: string): void {
  try {
    saveSummaryMarkdown(run);
    const learning = extractLearnings(run, command);
    saveArtifact(run.workflowId, "learning", learning);
    aggregateLearning(learning);
  } catch {
    // Best-effort
  }
}
