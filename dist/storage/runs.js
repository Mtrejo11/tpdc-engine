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
const local_1 = require("./local");
const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");
function loadRun(runId) {
    const runDir = path.join(ARTIFACTS_DIR, runId);
    if (!fs.existsSync(runDir))
        return null;
    const workflow = (0, local_1.loadArtifact)(runId, "workflow");
    if (!workflow)
        return null;
    // List all artifact files
    const artifactPaths = fs.readdirSync(runDir)
        .filter((f) => f.endsWith(".json") || f.endsWith(".txt"))
        .map((f) => path.join(runDir, f));
    // Extract original request from intake
    const intake = (0, local_1.loadArtifact)(runId, "intake");
    const originalRequest = intake?.title
        || intake?.body
        || (workflow.summary || "").substring(0, 120);
    // Extract score + findings from validate
    const validate = (0, local_1.loadArtifact)(runId, "validate");
    const score = validate?.score;
    const findings = validate?.findings;
    // Extract block reason + questions from decompose
    const decompose = (0, local_1.loadArtifact)(runId, "decompose");
    const blockReason = decompose?.status === "blocked"
        ? decompose.blockedReason
        : undefined;
    const openQuestions = decompose?.unresolvedQuestions;
    // Mutation data
    const mutation = workflow.mutation;
    return {
        workflowId: workflow.workflowId,
        timestamp: workflow.timestamp,
        executionMode: workflow.executionMode,
        adapter: workflow.adapter,
        finalVerdict: workflow.finalVerdict,
        totalDurationMs: workflow.totalDurationMs,
        summary: workflow.summary,
        stages: workflow.stages || [],
        score,
        findings,
        openQuestions,
        blockReason,
        originalRequest,
        mutation: mutation?.applied !== undefined ? mutation : undefined,
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