#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const loader_1 = require("./registry/loader");
const runCapability_1 = require("./runtime/runCapability");
const workflow_1 = require("./runtime/workflow");
const claude_adapter_1 = require("./runtime/claude-adapter");
const claude_code_adapter_1 = require("./runtime/claude-code-adapter");
const agent_sdk_adapter_1 = require("./runtime/agent-sdk-adapter");
const types_1 = require("./runtime/types");
const runs_1 = require("./storage/runs");
const showRenderer_1 = require("./plugin/renderers/showRenderer");
const diffRenderer_1 = require("./plugin/renderers/diffRenderer");
const summary_1 = require("./storage/summary");
const bugNormalizer_1 = require("./plugin/handlers/bugNormalizer");
const bugRenderer_1 = require("./plugin/renderers/bugRenderer");
const assessNormalizer_1 = require("./plugin/handlers/assessNormalizer");
const assessRenderer_1 = require("./plugin/renderers/assessRenderer");
const discoveryNormalizer_1 = require("./plugin/handlers/discoveryNormalizer");
const discoveryArtifact_1 = require("./plugin/handlers/discoveryArtifact");
const discoveryRenderer_1 = require("./plugin/renderers/discoveryRenderer");
const refactorNormalizer_1 = require("./plugin/handlers/refactorNormalizer");
const refactorArtifact_1 = require("./plugin/handlers/refactorArtifact");
const refactorRenderer_1 = require("./plugin/renderers/refactorRenderer");
const planNormalizer_1 = require("./plugin/handlers/planNormalizer");
const planArtifact_1 = require("./plugin/handlers/planArtifact");
const planRenderer_1 = require("./plugin/renderers/planRenderer");
const local_1 = require("./storage/local");
const learning_1 = require("./learning");
const INSTALLED_DIR = path.resolve(__dirname, "../capabilities/installed");
/**
 * Augment a request with lessons from prior runs.
 */
function withLessons(request, command, tags = []) {
    return (0, learning_1.injectLessons)(request, command, tags);
}
/**
 * Extract and persist learnings from a completed run.
 */
function learnFromRun(run, command) {
    try {
        const learning = (0, learning_1.extractLearnings)(run, command);
        (0, local_1.saveArtifact)(run.workflowId, "learning", learning);
        (0, learning_1.aggregateLearning)(learning);
    }
    catch (err) {
        process.stderr.write(`[TPDC] Warning: learning extraction failed: ${err}\n`);
    }
}
function createAdapter() {
    const adapterEnv = process.env.TPDC_ADAPTER;
    const model = process.env.TPDC_MODEL || undefined;
    if (adapterEnv === "mock") {
        console.log("[Engine] Using MockLLMAdapter (TPDC_ADAPTER=mock)");
        return new types_1.MockLLMAdapter();
    }
    if (adapterEnv === "sdk") {
        console.log(`[Engine] Using AgentSdkAdapter (SDK)${model ? ` (${model})` : ""}`);
        return new agent_sdk_adapter_1.AgentSdkAdapter({ model });
    }
    if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
        console.log(`[Engine] Using ClaudeAdapter (API)${model ? ` (${model})` : ""}`);
        return new claude_adapter_1.ClaudeAdapter({ model });
    }
    // Default: Claude Code CLI — uses Max subscription tokens
    console.log(`[Engine] Using ClaudeCodeAdapter (CLI)${model ? ` (${model})` : ""}`);
    return new claude_code_adapter_1.ClaudeCodeAdapter({ model });
}
/**
 * Parse TPDC_STAGE_MODELS env var into a Record<string, string>.
 * Format: "intake:haiku,design:sonnet,execute-patch:opus"
 */
function parseStageModels() {
    const raw = process.env.TPDC_STAGE_MODELS;
    if (!raw)
        return undefined;
    const models = {};
    for (const pair of raw.split(",")) {
        const [stage, model] = pair.trim().split(":");
        if (stage && model)
            models[stage.trim()] = model.trim();
    }
    return Object.keys(models).length > 0 ? models : undefined;
}
/**
 * Parse TPDC_STAGE_TIMEOUTS env var into a Record<string, number>.
 * Format: "execute-patch:600000,design:120000"
 */
function parseStageTimeouts() {
    const raw = process.env.TPDC_STAGE_TIMEOUTS;
    if (!raw)
        return undefined;
    const timeouts = {};
    for (const pair of raw.split(",")) {
        const [stage, ms] = pair.trim().split(":");
        if (stage && ms) {
            const val = parseInt(ms.trim(), 10);
            if (!isNaN(val))
                timeouts[stage.trim()] = val;
        }
    }
    return Object.keys(timeouts).length > 0 ? timeouts : undefined;
}
async function main() {
    const [command, ...args] = process.argv.slice(2);
    const stageModels = parseStageModels();
    const stageTimeouts = parseStageTimeouts();
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
            const caps = (0, loader_1.listInstalledCapabilities)();
            if (caps.length === 0) {
                console.log("No capabilities installed.");
            }
            else {
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
            let input;
            if (inputArg) {
                // Check if it's a file path
                if (fs.existsSync(inputArg)) {
                    input = JSON.parse(fs.readFileSync(inputArg, "utf-8"));
                }
                else {
                    // Try parsing as JSON string
                    try {
                        input = JSON.parse(inputArg);
                    }
                    catch {
                        // Treat as plain text request
                        input = inputArg;
                    }
                }
            }
            else {
                // Read from stdin
                input = "";
            }
            const llm = createAdapter();
            const result = await (0, runCapability_1.runCapability)(capId, input, { llm });
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
            const flagValue = (flag) => {
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
            const result = await (0, workflow_1.runWorkflow)(withLessons(text, "solve"), {
                llm,
                quiet: false,
                apply: applyFlag,
                confirmApply: confirmApplyFlag,
                interactive: useInteractive,
                repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
                stageModels,
                stageTimeouts,
            });
            // Persist summary.md + learnings
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                (0, summary_1.saveSummaryMarkdown)(run);
                learnFromRun(run, "solve");
            }
            // Render summary
            console.log((0, workflow_1.renderWorkflowSummary)(result));
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
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
            const flagValue = (flag) => {
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
            const bugCtx = (0, bugNormalizer_1.normalizeBugReport)(text);
            const llm = createAdapter();
            const result = await (0, workflow_1.runWorkflow)(withLessons(bugCtx.normalizedRequest, "fix"), {
                llm,
                quiet: false,
                apply: applyFlag,
                confirmApply: confirmApplyFlag,
                interactive: useInteractive,
                repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
                stageModels,
                stageTimeouts,
            });
            // Persist summary.md + learnings
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                (0, summary_1.saveSummaryMarkdown)(run);
                learnFromRun(run, "fix");
                // Render bug-specific output
                console.log((0, bugRenderer_1.renderBugResult)(run, bugCtx));
            }
            else {
                // Fallback to standard renderer
                console.log((0, workflow_1.renderWorkflowSummary)(result));
            }
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
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
            const flagValue = (flag) => {
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
            const refactorCtx = (0, refactorNormalizer_1.normalizeRefactor)(text);
            const llm = createAdapter();
            const result = await (0, workflow_1.runWorkflow)(withLessons(refactorCtx.normalizedRequest, "refactor"), {
                llm,
                quiet: false,
                apply: applyFlag,
                confirmApply: confirmApplyFlag,
                interactive: useInteractive,
                repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
                stageModels,
                stageTimeouts,
            });
            // Build refactor artifact + persist + learn
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                const artifact = (0, refactorArtifact_1.buildRefactorArtifact)(run, text, refactorCtx.category, refactorCtx.targets);
                (0, local_1.saveArtifact)(result.workflowId, "refactor", artifact);
                (0, summary_1.saveSummaryMarkdown)(run);
                learnFromRun(run, "refactor");
                console.log((0, refactorRenderer_1.renderRefactorResult)(run, artifact));
            }
            else {
                console.log((0, workflow_1.renderWorkflowSummary)(result));
            }
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
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
            const assessCtx = (0, assessNormalizer_1.normalizeAssessment)(text);
            const llm = createAdapter();
            // Always safe mode — no patches, no apply
            const result = await (0, workflow_1.runWorkflow)(withLessons(assessCtx.normalizedRequest, "assess"), {
                llm,
                quiet: false,
                stageModels,
                stageTimeouts,
            });
            // Persist summary.md + learnings
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                (0, summary_1.saveSummaryMarkdown)(run);
                learnFromRun(run, "assess");
                // Render assessment-specific output
                console.log((0, assessRenderer_1.renderAssessResult)(run, assessCtx));
            }
            else {
                // Fallback to standard renderer
                console.log((0, workflow_1.renderWorkflowSummary)(result));
            }
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
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
            const planCtx = (0, planNormalizer_1.normalizePlan)(text);
            const llm = createAdapter();
            // Always safe mode — planning never mutates
            const result = await (0, workflow_1.runWorkflow)(withLessons(planCtx.normalizedRequest, "plan"), {
                llm,
                quiet: false,
                stageModels,
                stageTimeouts,
            });
            // Build plan artifact from workflow outputs
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                const artifact = (0, planArtifact_1.buildPlanArtifact)(run, text, planCtx.likelyCommand);
                // Persist plan artifact + learnings
                (0, local_1.saveArtifact)(result.workflowId, "plan", artifact);
                learnFromRun(run, "plan");
                // Persist plan-oriented summary.md
                const summaryContent = (0, planRenderer_1.renderPlanMarkdown)(artifact, run);
                const summaryPath = path.join(path.resolve(__dirname, "../artifacts"), result.workflowId, "summary.md");
                fs.writeFileSync(summaryPath, summaryContent, "utf-8");
                // Render plan output
                console.log((0, planRenderer_1.renderPlanResult)(run, artifact));
            }
            else {
                console.log((0, workflow_1.renderWorkflowSummary)(result));
            }
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
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
            const discCtx = (0, discoveryNormalizer_1.normalizeDiscovery)(text);
            const llm = createAdapter();
            // Always safe mode — discovery never mutates
            const result = await (0, workflow_1.runWorkflow)(withLessons(discCtx.normalizedRequest, "discovery"), {
                llm,
                quiet: false,
                stageModels,
                stageTimeouts,
            });
            // Build discovery artifact from workflow outputs
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                const artifact = (0, discoveryArtifact_1.buildDiscoveryArtifact)(run, text, discCtx.likelyCommand);
                // Persist discovery artifact + learnings
                (0, local_1.saveArtifact)(result.workflowId, "discovery", artifact);
                learnFromRun(run, "discovery");
                // Persist discovery-oriented summary.md
                const summaryContent = (0, discoveryRenderer_1.renderDiscoveryMarkdown)(artifact, run);
                const summaryPath = path.join(path.resolve(__dirname, "../artifacts"), result.workflowId, "summary.md");
                fs.writeFileSync(summaryPath, summaryContent, "utf-8");
                // Render discovery output
                console.log((0, discoveryRenderer_1.renderDiscoveryResult)(artifact, run));
            }
            else {
                console.log((0, workflow_1.renderWorkflowSummary)(result));
            }
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
                process.exitCode = 2;
            }
            break;
        }
        // ── show ──────────────────────────────────────────────────────────
        case "show": {
            const runIdArg = args[0];
            if (!runIdArg) {
                // List recent runs
                const runs = (0, runs_1.listRuns)().slice(0, 10);
                if (runs.length === 0) {
                    console.log("No workflow runs found.");
                }
                else {
                    console.log("\n  Recent runs:\n");
                    for (const id of runs) {
                        const run = (0, runs_1.loadRun)(id);
                        if (run) {
                            const icon = run.finalVerdict === "pass" ? "✓"
                                : run.finalVerdict === "fail" ? "✗"
                                    : run.finalVerdict === "blocked" ? "⊘"
                                        : "?";
                            const score = run.score !== undefined ? ` (${run.score}/100)` : "";
                            const req = run.originalRequest ? ` — ${run.originalRequest.substring(0, 50)}` : "";
                            console.log(`  ${icon} ${id}  ${run.finalVerdict.padEnd(8)}${score}${req}`);
                        }
                        else {
                            console.log(`  ? ${id}  (no workflow.json)`);
                        }
                    }
                    console.log("");
                    console.log("  Usage: tpdc show <runId>");
                }
                process.exit(0);
            }
            const resolvedId = (0, runs_1.resolveRunId)(runIdArg);
            if (!resolvedId) {
                console.error(`Run not found: ${runIdArg}`);
                console.error("Tip: use a unique substring of the run ID");
                process.exit(1);
            }
            const run = (0, runs_1.loadRun)(resolvedId);
            if (!run) {
                console.error(`Could not load run: ${resolvedId}`);
                process.exit(1);
            }
            console.log((0, showRenderer_1.renderShow)(run));
            break;
        }
        // ── diff ──────────────────────────────────────────────────────────
        case "diff": {
            const runIdArg = args[0];
            if (!runIdArg) {
                console.error("Usage: tpdc diff <runId>");
                process.exit(1);
            }
            const resolvedId = (0, runs_1.resolveRunId)(runIdArg);
            if (!resolvedId) {
                console.error(`Run not found: ${runIdArg}`);
                process.exit(1);
            }
            const run = (0, runs_1.loadRun)(resolvedId);
            if (!run) {
                console.error(`Could not load run: ${resolvedId}`);
                process.exit(1);
            }
            console.log((0, diffRenderer_1.renderDiff)(run));
            break;
        }
        // ── run-workflow (full-form, existing) ────────────────────────────
        case "run-workflow": {
            // Parse named flags
            const flagValue = (flag) => {
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
            let request;
            if (textValue) {
                if (titleValue) {
                    request = { title: titleValue, body: textValue, source: "cli" };
                }
                else {
                    request = textValue;
                }
            }
            else if (fileValue) {
                if (!fs.existsSync(fileValue)) {
                    console.error(`File not found: ${fileValue}`);
                    process.exit(1);
                }
                request = JSON.parse(fs.readFileSync(fileValue, "utf-8"));
            }
            else {
                // Positional arg: file path or raw JSON (skip flags)
                const positionalArgs = args.filter((a) => !a.startsWith("--") && !["--text", "--title", "--file", "--repo-root"].includes(args[args.indexOf(a) - 1] || ""));
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
                }
                else {
                    try {
                        request = JSON.parse(inputArg);
                    }
                    catch {
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
            const result = await (0, workflow_1.runWorkflow)(augmented, {
                llm,
                quiet: false,
                apply: applyFlag,
                confirmApply: confirmApplyFlag,
                interactive: useInteractive,
                repoRoot: repoRootValue ? path.resolve(repoRootValue) : undefined,
                stageModels,
                stageTimeouts,
            });
            // Persist summary.md + learnings
            const run = (0, runs_1.loadRun)(result.workflowId);
            if (run) {
                (0, summary_1.saveSummaryMarkdown)(run);
                learnFromRun(run, "solve");
            }
            // Render summary
            console.log((0, workflow_1.renderWorkflowSummary)(result));
            if (result.finalVerdict === "fail") {
                process.exitCode = 1;
            }
            else if (result.finalVerdict === "blocked" || result.finalVerdict === "inconclusive") {
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
//# sourceMappingURL=cli.js.map