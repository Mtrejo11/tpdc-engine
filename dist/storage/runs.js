"use strict";
/**
 * Run inspection helpers.
 *
 * Loads and summarises completed workflow runs from the artifacts directory.
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
exports.loadRun = loadRun;
exports.listRuns = listRuns;
exports.resolveRunId = resolveRunId;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zod_1 = require("zod");
const local_1 = require("./local");
const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");
// Lightweight schemas for safe artifact reading (subset of full schemas)
const WorkflowArtifactSchema = zod_1.z.object({
    workflowId: zod_1.z.string(),
    timestamp: zod_1.z.string(),
    executionMode: zod_1.z.enum(["safe", "mutation"]),
    adapter: zod_1.z.object({ adapterId: zod_1.z.string(), modelId: zod_1.z.string(), transport: zod_1.z.string() }),
    finalVerdict: zod_1.z.string(),
    totalDurationMs: zod_1.z.number(),
    summary: zod_1.z.string(),
    stages: zod_1.z.array(zod_1.z.object({
        capabilityId: zod_1.z.string(),
        status: zod_1.z.string(),
        durationMs: zod_1.z.number(),
        blockReason: zod_1.z.string().optional(),
    })),
    mutation: zod_1.z.object({
        applied: zod_1.z.boolean(),
        branchName: zod_1.z.string(),
        commitHash: zod_1.z.string(),
        filesChanged: zod_1.z.array(zod_1.z.string()),
        patchGenerated: zod_1.z.boolean(),
        dryRunPassed: zod_1.z.boolean(),
        confirmationSource: zod_1.z.string(),
        rollbackTriggered: zod_1.z.boolean(),
        errors: zod_1.z.array(zod_1.z.string()),
    }).optional(),
});
const IntakeReadSchema = zod_1.z.object({
    title: zod_1.z.string().optional(),
    body: zod_1.z.string().optional(),
    problem_statement: zod_1.z.string().optional(),
}).passthrough();
const ValidateReadSchema = zod_1.z.object({
    score: zod_1.z.number().optional(),
    findings: zod_1.z.array(zod_1.z.object({
        category: zod_1.z.string(),
        severity: zod_1.z.string(),
        description: zod_1.z.string(),
    })).optional(),
}).passthrough();
const DecomposeReadSchema = zod_1.z.object({
    status: zod_1.z.string().optional(),
    blockedReason: zod_1.z.string().optional(),
    unresolvedQuestions: zod_1.z.array(zod_1.z.object({
        question: zod_1.z.string(),
        owner: zod_1.z.string(),
    })).optional(),
}).passthrough();
function loadRun(runId) {
    const runDir = path.join(ARTIFACTS_DIR, runId);
    if (!fs.existsSync(runDir))
        return null;
    const workflow = (0, local_1.loadTypedArtifact)(runId, "workflow", WorkflowArtifactSchema);
    if (!workflow)
        return null;
    // List all artifact files
    const artifactPaths = fs.readdirSync(runDir)
        .filter((f) => f.endsWith(".json") || f.endsWith(".txt"))
        .map((f) => path.join(runDir, f));
    // Extract original request from intake
    const intake = (0, local_1.loadTypedArtifact)(runId, "intake", IntakeReadSchema);
    const originalRequest = intake?.title
        || intake?.body
        || workflow.summary.substring(0, 120);
    // Extract score + findings from validate
    const validate = (0, local_1.loadTypedArtifact)(runId, "validate", ValidateReadSchema);
    // Extract block reason + questions from decompose
    const decompose = (0, local_1.loadTypedArtifact)(runId, "decompose", DecomposeReadSchema);
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
function listRuns() {
    if (!fs.existsSync(ARTIFACTS_DIR))
        return [];
    return fs.readdirSync(ARTIFACTS_DIR)
        .filter((d) => d.startsWith("wf_") && fs.statSync(path.join(ARTIFACTS_DIR, d)).isDirectory())
        .sort()
        .reverse();
}
function resolveRunId(partial) {
    if (!fs.existsSync(ARTIFACTS_DIR))
        return null;
    // Exact match
    const exact = path.join(ARTIFACTS_DIR, partial);
    if (fs.existsSync(exact))
        return partial;
    // Partial match (suffix)
    const all = listRuns();
    const matches = all.filter((r) => r.includes(partial));
    return matches.length === 1 ? matches[0] : null;
}
//# sourceMappingURL=runs.js.map