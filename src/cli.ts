#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { listInstalledCapabilities } from "./registry/loader";
import { runCapability } from "./runtime/runCapability";
import { runWorkflow, renderWorkflowSummary } from "./runtime/workflow";
import { ClaudeAdapter } from "./runtime/claude-adapter";
import { ClaudeCodeAdapter } from "./runtime/claude-code-adapter";
import { MockLLMAdapter, LLMAdapter } from "./runtime/types";
import { loadRun, listRuns, resolveRunId } from "./storage/runs";
import { renderShow } from "./plugin/renderers/showRenderer";
import { renderDiff } from "./plugin/renderers/diffRenderer";
import { renderSummaryMarkdown } from "./plugin/renderers/summaryMarkdown";
import { saveSummaryMarkdown } from "./storage/summary";
import { normalizeBugReport } from "./plugin/handlers/bugNormalizer";
import { renderBugResult } from "./plugin/renderers/bugRenderer";
import { normalizeAssessment } from "./plugin/handlers/assessNormalizer";
import { renderAssessResult } from "./plugin/renderers/assessRenderer";
import { normalizeDiscovery } from "./plugin/handlers/discoveryNormalizer";
import { buildDiscoveryArtifact } from "./plugin/handlers/discoveryArtifact";
import { renderDiscoveryResult, renderDiscoveryMarkdown } from "./plugin/renderers/discoveryRenderer";
import { normalizeRefactor } from "./plugin/handlers/refactorNormalizer";
import { buildRefactorArtifact } from "./plugin/handlers/refactorArtifact";
import { renderRefactorResult } from "./plugin/renderers/refactorRenderer";
import { normalizePlan } from "./plugin/handlers/planNormalizer";
import { buildPlanArtifact } from "./plugin/handlers/planArtifact";
import { renderPlanResult, renderPlanMarkdown } from "./plugin/renderers/planRenderer";
import { saveArtifact } from "./storage/local";
import { extractLearnings, aggregateLearning, injectLessons } from "./learning";

const INSTALLED_DIR = path.resolve(__dirname, "../capabilities/installed");

/**
 * Augment a request with lessons from prior runs.
 */
function withLessons(request: string, command: string, tags: string[] = []): string {
  return injectLessons(request, command, tags);
}

/**
 * Extract and persist learnings from a completed run.
 */
function learnFromRun(run: import("./storage/runs").RunSummary, command: string): void {
  try {
    const learning = extractLearnings(run, command);
    saveArtifact(run.workflowId, "learning", learning);
    aggregateLearning(learning);
  } catch (err) {
    process.stderr.write(`[TPDC] Warning: learning extraction failed: ${err}\n`);
  }
}

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;

  if (adapterEnv === "mock") {
    console.log("[Engine] Using MockLLMAdapter (TPDC_ADAPTER=mock)");
    return new MockLLMAdapter();
  }

  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
    console.log(`[Engine] Using ClaudeAdapter (API)${model ? ` (${model})` : ""}`);
    return new ClaudeAdapter({ model });
  }

  // Default: Claude Code CLI — uses Max subscription tokens
  console.log(`[Engine] Using ClaudeCodeAdapter (CLI)${model ? ` (${model})` : ""}`);
  return new ClaudeCodeAdapter({ model });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "install-capability": {
      const sourcePath = args[0];
      if (!sourcePath) {
        console.error("Usage: tpdc-engine install-capability <path-to-bundle>");
        process.exit(1);
      }

      const absSource = path.resolve(sourcePath);
      if (!fs.existsSync(absSource)) {
        console.error(`Source not found: ${absSource}`);
        process.exit(1);
      }

      // Read capability.json from source
      const manifestPath = path.join(absSource, "capability.json");
      if (!fs.existsSync(manifestPath)) {
        console.error("No capability.json found in source directory");
        process.exit(1);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      // Validate manifest.id and manifest.version to prevent path traversal
      const SAFE_ID = /^[a-zA-Z0-9._-]+$/;
      if (!manifest.id || !SAFE_ID.test(manifest.id)) {
        console.error(`Invalid capability ID: "${manifest.id}" — only alphanumeric, dot, dash, and underscore allowed`);
        process.exit(1);
      }
      if (!manifest.version || !SAFE_ID.test(manifest.version)) {
        console.error(`Invalid capability version: "${manifest.version}" — only alphanumeric, dot, dash, and underscore allowed`);
        process.exit(1);
      }

      const targetDir = path.join(INSTALLED_DIR, manifest.id, manifest.version);
      if (!targetDir.startsWith(INSTALLED_DIR + path.sep)) {
        console.error("Invalid capability path — escapes installed directory");
        process.exit(1);
      }

      // Copy all files
      fs.mkdirSync(targetDir, { recursive: true });
      const files = fs.readdirSync(absSource);
      for (const file of files) {
        const srcFile = path.join(absSource, file);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, path.join(targetDir, file));
        }
      }

      console.log(`Installed: ${manifest.id}@${manifest.version} -> ${targetDir}`);
      break;
    }

    case "list-capabilities": {
      const caps = listInstalledCapabilities();
      if (caps.length === 0) {
        console.log("No capabilities installed.");
      } else {
        console.log("Installed capabilities:\n");
        for (const cap of caps) {
          console.log(`  ${cap.id}@${cap.version} [${cap.stage}] (${cap.status})`);
        }
      }
      break;
    }

    case "run-capability": {
      const capId = args[0];
      const inputArg = args[1];

      if (!capId) {
        console.error("Usage: tpdc-engine run-capability <capability-id> [input-json-or-file]");
        process.exit(1);
      }

      let input: unknown;
      if (inputArg) {
        // Check if it's a file path
        if (fs.existsSync(inputArg)) {
          input = JSON.parse(fs.readFileSync(inputArg, "utf-8"));
        } else {
          // Try parsing as JSON string
          try {
            input = JSON.parse(inputArg);
          } catch {
            // Treat as plain text request
            input = inputArg;
          }
        }
      } else {
        // Read from stdin
        input = "";
      }

      const llm = createAdapter();
      const result = await runCapability(capId, input, { llm });
      console.log("\n--- Result ---");
      console.log(JSON.stringify(result, null, 2));
      if (result.validationErrors) {
        console.error("\nValidation errors found — output may be incomplete.");
        process.exitCode = 2;
      }
      break;
    }

    // ── solve ──────────────────────────────────────────────────────────
    // Short alias: `tpdc solve "request"` → runs full workflow
    case "solve": {
      const text = args[0];
      if (!text) {
        console.error('Usage: tpdc solve "<request>"');
        console.error('       tpdc solve "<request>" --apply --repo-root <path>');
        process.exit(1);
      }

      const flagValue = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : undefined;
      };

      const applyFlag = args.includes("--apply");
      const confirmApplyFlag = args.includes("--confirm-apply");
      const interactiveFlag = args.includes("--interactive");
      const repoRootValue = flagValue("--repo-root");
      const useInteractive = interactiveFlag || (applyFlag && !confirmApplyFlag && process.stdin.isTTY === true);

      if (applyFlag && !repoRootValue) {
        console.error("Error: --apply requires --repo-root <path>");
        process.exit(1);
      }

      const llm = createAdapter();
      const result = await runWorkflow(withLessons(text, "solve"), {
        llm,
        quiet: false,
        apply: applyFlag,
        confirmApply: confirmApplyFlag,
        interactive: useInteractive,
        repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
      });

      // Persist summary.md + learnings
      const run = loadRun(result.workflowId);
      if (run) {
        saveSummaryMarkdown(run);
        learnFromRun(run, "solve");
      }

      // Render summary
      console.log(renderWorkflowSummary(result));

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    // ── fix ───────────────────────────────────────────────────────────
    // Bug-fix specialization: normalizes input, runs workflow, renders bug-oriented output
    case "fix": {
      const text = args[0];
      if (!text) {
        console.error('Usage: tpdc fix "<bug description>"');
        console.error('       tpdc fix "<bug description>" --apply --repo-root <path>');
        process.exit(1);
      }

      const flagValue = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : undefined;
      };

      const applyFlag = args.includes("--apply");
      const confirmApplyFlag = args.includes("--confirm-apply");
      const interactiveFlag = args.includes("--interactive");
      const repoRootValue = flagValue("--repo-root");
      const useInteractive = interactiveFlag || (applyFlag && !confirmApplyFlag && process.stdin.isTTY === true);

      if (applyFlag && !repoRootValue) {
        console.error("Error: --apply requires --repo-root <path>");
        process.exit(1);
      }

      // Normalize the bug report
      const bugCtx = normalizeBugReport(text);

      const llm = createAdapter();
      const result = await runWorkflow(withLessons(bugCtx.normalizedRequest, "fix"), {
        llm,
        quiet: false,
        apply: applyFlag,
        confirmApply: confirmApplyFlag,
        interactive: useInteractive,
        repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
      });

      // Persist summary.md + learnings
      const run = loadRun(result.workflowId);
      if (run) {
        saveSummaryMarkdown(run);
        learnFromRun(run, "fix");
        // Render bug-specific output
        console.log(renderBugResult(run, bugCtx));
      } else {
        // Fallback to standard renderer
        console.log(renderWorkflowSummary(result));
      }

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    // ── refactor ──────────────────────────────────────────────────────
    // Structural improvement: supports mutation mode
    case "refactor": {
      const text = args[0];
      if (!text) {
        console.error('Usage: tpdc refactor "<refactor request>"');
        console.error('       tpdc refactor "<refactor request>" --apply --repo-root <path>');
        console.error("");
        console.error("Examples:");
        console.error('  tpdc refactor "Extract image upload retry logic into a dedicated service"');
        console.error('  tpdc refactor "Split PlantViewModal into smaller components"');
        console.error('  tpdc refactor "Consolidate AsyncStorage helpers into a shared storage module"');
        process.exit(1);
      }

      const flagValue = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : undefined;
      };

      const applyFlag = args.includes("--apply");
      const confirmApplyFlag = args.includes("--confirm-apply");
      const interactiveFlag = args.includes("--interactive");
      const repoRootValue = flagValue("--repo-root");
      const useInteractive = interactiveFlag || (applyFlag && !confirmApplyFlag && process.stdin.isTTY === true);

      if (applyFlag && !repoRootValue) {
        console.error("Error: --apply requires --repo-root <path>");
        process.exit(1);
      }

      // Normalize the refactor request
      const refactorCtx = normalizeRefactor(text);

      const llm = createAdapter();
      const result = await runWorkflow(withLessons(refactorCtx.normalizedRequest, "refactor"), {
        llm,
        quiet: false,
        apply: applyFlag,
        confirmApply: confirmApplyFlag,
        interactive: useInteractive,
        repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
      });

      // Build refactor artifact + persist + learn
      const run = loadRun(result.workflowId);
      if (run) {
        const artifact = buildRefactorArtifact(run, text, refactorCtx.category, refactorCtx.targets);
        saveArtifact(result.workflowId, "refactor", artifact);
        saveSummaryMarkdown(run);
        learnFromRun(run, "refactor");
        console.log(renderRefactorResult(run, artifact));
      } else {
        console.log(renderWorkflowSummary(result));
      }

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    // ── assess ─────────────────────────────────────────────────────────
    // Analysis/audit mode: safe-only, no patches, risk-oriented output
    case "assess": {
      const text = args[0];
      if (!text) {
        console.error('Usage: tpdc assess "<analysis request>"');
        console.error("");
        console.error("Examples:");
        console.error('  tpdc assess "Evaluate security risks in the image upload pipeline"');
        console.error('  tpdc assess "Analyze performance bottlenecks in TrainingFolderScreen"');
        console.error('  tpdc assess "Check for cross-tenant data leakage when switching orgs"');
        process.exit(1);
      }

      // Normalize the assessment request
      const assessCtx = normalizeAssessment(text);

      const llm = createAdapter();
      // Always safe mode — no patches, no apply
      const result = await runWorkflow(withLessons(assessCtx.normalizedRequest, "assess"), {
        llm,
        quiet: false,
      });

      // Persist summary.md + learnings
      const run = loadRun(result.workflowId);
      if (run) {
        saveSummaryMarkdown(run);
        learnFromRun(run, "assess");
        // Render assessment-specific output
        console.log(renderAssessResult(run, assessCtx));
      } else {
        // Fallback to standard renderer
        console.log(renderWorkflowSummary(result));
      }

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    // ── plan ──────────────────────────────────────────────────────────
    // Pre-execution planning: structured implementation plan without mutations
    case "plan": {
      const text = args[0];
      if (!text) {
        console.error('Usage: tpdc plan "<request>"');
        console.error("");
        console.error("Examples:");
        console.error('  tpdc plan "Implement tenant reset on logout in Field Lite"');
        console.error('  tpdc plan "Port Models Download from Pocket to HQ"');
        console.error('  tpdc plan "Add AI summaries popup in FARM"');
        process.exit(1);
      }

      // Normalize the plan request
      const planCtx = normalizePlan(text);

      const llm = createAdapter();
      // Always safe mode — planning never mutates
      const result = await runWorkflow(withLessons(planCtx.normalizedRequest, "plan"), {
        llm,
        quiet: false,
      });

      // Build plan artifact from workflow outputs
      const run = loadRun(result.workflowId);
      if (run) {
        const artifact = buildPlanArtifact(run, text, planCtx.likelyCommand);

        // Persist plan artifact + learnings
        saveArtifact(result.workflowId, "plan", artifact);
        learnFromRun(run, "plan");

        // Persist plan-oriented summary.md
        const summaryContent = renderPlanMarkdown(artifact, run);
        const summaryPath = path.join(
          path.resolve(__dirname, "../artifacts"),
          result.workflowId,
          "summary.md",
        );
        fs.writeFileSync(summaryPath, summaryContent, "utf-8");

        // Render plan output
        console.log(renderPlanResult(run, artifact));
      } else {
        console.log(renderWorkflowSummary(result));
      }

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    // ── discovery ──────────────────────────────────────────────────────
    // Pre-workflow framing: clarify vague ideas before execution
    case "discovery": {
      const text = args[0];
      if (!text) {
        console.error('Usage: tpdc discovery "<idea>"');
        console.error("");
        console.error("Examples:");
        console.error('  tpdc discovery "We need to prevent org data leakage when switching orgs"');
        console.error('  tpdc discovery "We want to improve offline image reliability"');
        console.error('  tpdc discovery "We need to port Models Download from Pocket to HQ"');
        process.exit(1);
      }

      // Normalize the discovery request
      const discCtx = normalizeDiscovery(text);

      const llm = createAdapter();
      // Always safe mode — discovery never mutates
      const result = await runWorkflow(withLessons(discCtx.normalizedRequest, "discovery"), {
        llm,
        quiet: false,
      });

      // Build discovery artifact from workflow outputs
      const run = loadRun(result.workflowId);
      if (run) {
        const artifact = buildDiscoveryArtifact(run, text, discCtx.likelyCommand);

        // Persist discovery artifact + learnings
        saveArtifact(result.workflowId, "discovery", artifact);
        learnFromRun(run, "discovery");

        // Persist discovery-oriented summary.md
        const summaryContent = renderDiscoveryMarkdown(artifact, run);
        const summaryPath = path.join(
          path.resolve(__dirname, "../artifacts"),
          result.workflowId,
          "summary.md",
        );
        fs.writeFileSync(summaryPath, summaryContent, "utf-8");

        // Render discovery output
        console.log(renderDiscoveryResult(artifact, run));
      } else {
        console.log(renderWorkflowSummary(result));
      }

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    // ── show ──────────────────────────────────────────────────────────
    case "show": {
      const runIdArg = args[0];
      if (!runIdArg) {
        // List recent runs
        const runs = listRuns().slice(0, 10);
        if (runs.length === 0) {
          console.log("No workflow runs found.");
        } else {
          console.log("\n  Recent runs:\n");
          for (const id of runs) {
            const run = loadRun(id);
            if (run) {
              const icon = run.finalVerdict === "pass" ? "✓"
                : run.finalVerdict === "fail" ? "✗"
                : run.finalVerdict === "blocked" ? "⊘"
                : "?";
              const score = run.score !== undefined ? ` (${run.score}/100)` : "";
              const req = run.originalRequest ? ` — ${run.originalRequest.substring(0, 50)}` : "";
              console.log(`  ${icon} ${id}  ${run.finalVerdict.padEnd(8)}${score}${req}`);
            } else {
              console.log(`  ? ${id}  (no workflow.json)`);
            }
          }
          console.log("");
          console.log("  Usage: tpdc show <runId>");
        }
        process.exit(0);
      }

      const resolvedId = resolveRunId(runIdArg);
      if (!resolvedId) {
        console.error(`Run not found: ${runIdArg}`);
        console.error("Tip: use a unique substring of the run ID");
        process.exit(1);
      }

      const run = loadRun(resolvedId);
      if (!run) {
        console.error(`Could not load run: ${resolvedId}`);
        process.exit(1);
      }

      console.log(renderShow(run));
      break;
    }

    // ── diff ──────────────────────────────────────────────────────────
    case "diff": {
      const runIdArg = args[0];
      if (!runIdArg) {
        console.error("Usage: tpdc diff <runId>");
        process.exit(1);
      }

      const resolvedId = resolveRunId(runIdArg);
      if (!resolvedId) {
        console.error(`Run not found: ${runIdArg}`);
        process.exit(1);
      }

      const run = loadRun(resolvedId);
      if (!run) {
        console.error(`Could not load run: ${resolvedId}`);
        process.exit(1);
      }

      console.log(renderDiff(run));
      break;
    }

    // ── run-workflow (full-form, existing) ────────────────────────────
    case "run-workflow": {
      // Parse named flags
      const flagValue = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : undefined;
      };

      const textValue = flagValue("--text");
      const titleValue = flagValue("--title");
      const fileValue = flagValue("--file");
      const applyFlag = args.includes("--apply");
      const confirmApplyFlag = args.includes("--confirm-apply");
      const interactiveFlag = args.includes("--interactive");
      const repoRootValue = flagValue("--repo-root");

      // Default to interactive if TTY and --apply without --confirm-apply
      const useInteractive = interactiveFlag || (applyFlag && !confirmApplyFlag && process.stdin.isTTY === true);

      let request: unknown;

      if (textValue) {
        if (titleValue) {
          request = { title: titleValue, body: textValue, source: "cli" };
        } else {
          request = textValue;
        }
      } else if (fileValue) {
        if (!fs.existsSync(fileValue)) {
          console.error(`File not found: ${fileValue}`);
          process.exit(1);
        }
        request = JSON.parse(fs.readFileSync(fileValue, "utf-8"));
      } else {
        // Positional arg: file path or raw JSON (skip flags)
        const positionalArgs = args.filter((a) =>
          !a.startsWith("--") && !["--text", "--title", "--file", "--repo-root"].includes(args[args.indexOf(a) - 1] || "")
        );
        const inputArg = positionalArgs[0];
        if (!inputArg) {
          console.error("Usage: tpdc-engine run-workflow <request-json-or-file>");
          console.error("       tpdc-engine run-workflow --text \"<plain text>\" [--title \"<title>\"]");
          console.error("       tpdc-engine run-workflow --file <path-to-json>");
          console.error("");
          console.error("Mutation mode:");
          console.error("       tpdc-engine run-workflow --text \"...\" --apply --confirm-apply --repo-root <path>");
          process.exit(1);
        }

        if (fs.existsSync(inputArg)) {
          request = JSON.parse(fs.readFileSync(inputArg, "utf-8"));
        } else {
          try {
            request = JSON.parse(inputArg);
          } catch {
            request = inputArg;
          }
        }
      }

      if (applyFlag && !repoRootValue) {
        console.error("Error: --apply requires --repo-root <path>");
        process.exit(1);
      }

      const llm = createAdapter();
      const augmented = typeof request === "string" ? withLessons(request, "solve") : request;
      const result = await runWorkflow(augmented, {
        llm,
        quiet: false,
        apply: applyFlag,
        confirmApply: confirmApplyFlag,
        interactive: useInteractive,
        repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
      });

      // Persist summary.md + learnings
      const run = loadRun(result.workflowId);
      if (run) {
        saveSummaryMarkdown(run);
        learnFromRun(run, "solve");
      }

      // Render summary
      console.log(renderWorkflowSummary(result));

      if (result.finalVerdict === "fail") {
        process.exitCode = 1;
      } else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
        process.exitCode = 2;
      }
      break;
    }

    default:
      console.log("tpdc-engine — Runtime engine for TPDC capabilities\n");
      console.log("Commands:");
      console.log("  solve \"<request>\"             Run full pipeline (short form)");
      console.log("  fix \"<bug description>\"       Bug-fix flow with normalization");
      console.log("  refactor \"<request>\"          Structural improvement (supports --apply)");
      console.log("  assess \"<analysis request>\"   Analysis/audit mode (safe, no patches)");
      console.log("  plan \"<request>\"              Technical implementation plan (safe)");
      console.log("  discovery \"<idea>\"            Frame a vague idea before execution");
      console.log("  show [<runId>]                Inspect a run (or list recent runs)");
      console.log("  diff <runId>                  Show patch diff for mutation runs");
      console.log("");
      console.log("  run-workflow <request>        Run full pipeline (long form)");
      console.log("  run-capability <id> [input]   Run a single capability");
      console.log("  install-capability <path>     Install a capability bundle");
      console.log("  list-capabilities             List installed capabilities");
      console.log("");
      console.log("Options:");
      console.log("  --apply --repo-root <path>    Enable mutation mode");
      console.log("  --confirm-apply               Auto-confirm (non-interactive)");
      console.log("  --interactive                 Prompt before applying");
      console.log("");
      console.log("Environment:");
      console.log("  TPDC_ADAPTER=mock|api         Select LLM adapter");
      console.log("  TPDC_MODEL=<model>            Override model");
      console.log("  ANTHROPIC_API_KEY=<key>       Use API adapter");
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
