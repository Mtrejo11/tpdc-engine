"use strict";
/**
 * Command dispatcher for TPDC invocations.
 *
 * Maps parsed commands to existing engine functions.
 * Returns structured results suitable for Claude-facing rendering.
 */
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
exports.dispatch = dispatch;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const parser_1 = require("./parser");
const develop_1 = require("./develop");
const workflow_1 = require("../runtime/workflow");
const runs_1 = require("../storage/runs");
const local_1 = require("../storage/local");
const summary_1 = require("../storage/summary");
const learning_1 = require("../learning");
// Normalizers
const bugNormalizer_1 = require("../plugin/handlers/bugNormalizer");
const assessNormalizer_1 = require("../plugin/handlers/assessNormalizer");
const discoveryNormalizer_1 = require("../plugin/handlers/discoveryNormalizer");
const refactorNormalizer_1 = require("../plugin/handlers/refactorNormalizer");
const planNormalizer_1 = require("../plugin/handlers/planNormalizer");
// Artifact builders
const discoveryArtifact_1 = require("../plugin/handlers/discoveryArtifact");
const refactorArtifact_1 = require("../plugin/handlers/refactorArtifact");
const planArtifact_1 = require("../plugin/handlers/planArtifact");
// Renderers
const showRenderer_1 = require("../plugin/renderers/showRenderer");
const diffRenderer_1 = require("../plugin/renderers/diffRenderer");
const bugRenderer_1 = require("../plugin/renderers/bugRenderer");
const assessRenderer_1 = require("../plugin/renderers/assessRenderer");
const discoveryRenderer_1 = require("../plugin/renderers/discoveryRenderer");
const refactorRenderer_1 = require("../plugin/renderers/refactorRenderer");
const planRenderer_1 = require("../plugin/renderers/planRenderer");
const workflow_2 = require("../runtime/workflow");
const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");
// ── Dispatcher ───────────────────────────────────────────────────────
async function dispatch(invocation, options) {
    const { command, args, flags } = invocation;
    const { llm, quiet } = options;
    switch (command) {
        // ── Orchestrator commands ──
        case "develop": {
            const parsed = (0, parser_1.parseDevelopArgs)(args);
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
            const result = await (0, develop_1.runDevelop)(parsed.mode, parsed.request, mergedFlags, options);
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
                normalize: (text) => (0, learning_1.injectLessons)(text, "solve"),
                render: (run) => (0, workflow_2.renderWorkflowSummary)(run),
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
                    const bugCtx = (0, bugNormalizer_1.normalizeBugReport)(text);
                    return (0, learning_1.injectLessons)(bugCtx.normalizedRequest, "fix");
                },
                render: (run) => {
                    const bugCtx = (0, bugNormalizer_1.normalizeBugReport)(args);
                    return (0, bugRenderer_1.renderBugResult)(run, bugCtx);
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
                    const ctx = (0, refactorNormalizer_1.normalizeRefactor)(text);
                    return (0, learning_1.injectLessons)(ctx.normalizedRequest, "refactor");
                },
                render: (run) => {
                    const ctx = (0, refactorNormalizer_1.normalizeRefactor)(args);
                    const artifact = (0, refactorArtifact_1.buildRefactorArtifact)(run, args, ctx.category, ctx.targets);
                    (0, local_1.saveArtifact)(run.workflowId, "refactor", artifact);
                    return (0, refactorRenderer_1.renderRefactorResult)(run, artifact);
                },
                postProcess: (run) => learnAndSave(run, "refactor"),
            });
        case "assess":
            return handleWorkflow(command, args, {
                llm, quiet,
                normalize: (text) => {
                    const ctx = (0, assessNormalizer_1.normalizeAssessment)(text);
                    return (0, learning_1.injectLessons)(ctx.normalizedRequest, "assess");
                },
                render: (run) => {
                    const ctx = (0, assessNormalizer_1.normalizeAssessment)(args);
                    return (0, assessRenderer_1.renderAssessResult)(run, ctx);
                },
                postProcess: (run) => learnAndSave(run, "assess"),
            });
        case "plan":
            return handleWorkflow(command, args, {
                llm, quiet,
                normalize: (text) => {
                    const ctx = (0, planNormalizer_1.normalizePlan)(text);
                    return (0, learning_1.injectLessons)(ctx.normalizedRequest, "plan");
                },
                render: (run) => {
                    const ctx = (0, planNormalizer_1.normalizePlan)(args);
                    const artifact = (0, planArtifact_1.buildPlanArtifact)(run, args, ctx.likelyCommand);
                    (0, local_1.saveArtifact)(run.workflowId, "plan", artifact);
                    const md = (0, planRenderer_1.renderPlanMarkdown)(artifact, run);
                    fs.mkdirSync(path.join(ARTIFACTS_DIR, run.workflowId), { recursive: true });
                    fs.writeFileSync(path.join(ARTIFACTS_DIR, run.workflowId, "summary.md"), md, "utf-8");
                    return (0, planRenderer_1.renderPlanResult)(run, artifact);
                },
                postProcess: (run) => learnAndSave(run, "plan"),
            });
        case "discovery":
            return handleWorkflow(command, args, {
                llm, quiet,
                normalize: (text) => {
                    const ctx = (0, discoveryNormalizer_1.normalizeDiscovery)(text);
                    return (0, learning_1.injectLessons)(ctx.normalizedRequest, "discovery");
                },
                render: (run) => {
                    const ctx = (0, discoveryNormalizer_1.normalizeDiscovery)(args);
                    const artifact = (0, discoveryArtifact_1.buildDiscoveryArtifact)(run, args, ctx.likelyCommand);
                    (0, local_1.saveArtifact)(run.workflowId, "discovery", artifact);
                    const md = (0, discoveryRenderer_1.renderDiscoveryMarkdown)(artifact, run);
                    fs.mkdirSync(path.join(ARTIFACTS_DIR, run.workflowId), { recursive: true });
                    fs.writeFileSync(path.join(ARTIFACTS_DIR, run.workflowId, "summary.md"), md, "utf-8");
                    return (0, discoveryRenderer_1.renderDiscoveryResult)(artifact, run);
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
function handleShow(args) {
    if (!args) {
        // List recent runs
        const runs = (0, runs_1.listRuns)().slice(0, 10);
        if (runs.length === 0) {
            return { command: "show", output: "No workflow runs found." };
        }
        const lines = ["", "  Recent runs:", ""];
        for (const id of runs) {
            const run = (0, runs_1.loadRun)(id);
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
    const resolvedId = (0, runs_1.resolveRunId)(args);
    if (!resolvedId) {
        return { command: "show", output: `Run not found: ${args}`, error: "Run not found" };
    }
    const run = (0, runs_1.loadRun)(resolvedId);
    if (!run) {
        return { command: "show", output: `Could not load run: ${resolvedId}`, error: "Load failed" };
    }
    return {
        command: "show",
        workflowId: resolvedId,
        output: (0, showRenderer_1.renderShow)(run),
        verdict: run.finalVerdict,
        score: run.score,
    };
}
function handleDiff(args) {
    if (!args) {
        return { command: "diff", output: "Usage: tpdc:diff <runId>", error: "Missing runId" };
    }
    const resolvedId = (0, runs_1.resolveRunId)(args);
    if (!resolvedId) {
        return { command: "diff", output: `Run not found: ${args}`, error: "Run not found" };
    }
    const run = (0, runs_1.loadRun)(resolvedId);
    if (!run) {
        return { command: "diff", output: `Could not load run: ${resolvedId}`, error: "Load failed" };
    }
    return {
        command: "diff",
        workflowId: resolvedId,
        output: (0, diffRenderer_1.renderDiff)(run),
        verdict: run.finalVerdict,
        score: run.score,
    };
}
async function handleWorkflow(command, args, options) {
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
    const result = await (0, workflow_1.runWorkflow)(normalizedRequest, {
        llm: options.llm,
        quiet: options.quiet ?? true,
        apply: options.apply,
        confirmApply: options.confirmApply,
        interactive: options.interactive,
        repoRoot: options.repoRoot ? path.resolve(options.repoRoot) : undefined,
    });
    const run = (0, runs_1.loadRun)(result.workflowId);
    if (!run) {
        return {
            command,
            workflowId: result.workflowId,
            output: (0, workflow_2.renderWorkflowSummary)(result),
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
function learnAndSave(run, command) {
    try {
        (0, summary_1.saveSummaryMarkdown)(run);
        const learning = (0, learning_1.extractLearnings)(run, command);
        (0, local_1.saveArtifact)(run.workflowId, "learning", learning);
        (0, learning_1.aggregateLearning)(learning);
    }
    catch (err) {
        process.stderr.write(`[TPDC] Warning: learning extraction failed: ${err}\n`);
    }
}
//# sourceMappingURL=dispatcher.js.map