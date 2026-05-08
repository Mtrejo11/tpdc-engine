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
exports.runCapability = runCapability;
const loader_1 = require("../registry/loader");
const types_1 = require("./types");
const local_1 = require("../storage/local");
const protocols_1 = require("../protocols");
const crypto = __importStar(require("crypto"));
// Map output artifact names to their Zod schemas for runtime validation
const OUTPUT_VALIDATORS = {
    IntakeArtifact: protocols_1.IntakeArtifactSchema,
    SpecArtifact: protocols_1.SpecArtifactSchema,
    PlanArtifact: protocols_1.PlanArtifactSchema,
    ExecutionArtifact: protocols_1.ExecutionArtifactSchema,
    PatchArtifact: protocols_1.PatchArtifactSchema,
    EvalResult: protocols_1.EvalResultSchema,
};
function extractJson(raw) {
    // Strip markdown code fences if present
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }
    // Try to find a JSON object in the response
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
        return raw.substring(braceStart, braceEnd + 1);
    }
    return raw.trim();
}
async function runCapability(capabilityId, input, options) {
    const startTime = Date.now();
    const cap = (0, loader_1.loadCapability)(capabilityId, options?.version);
    if (!cap) {
        throw new Error(`Capability not found: ${capabilityId}${options?.version ? `@${options.version}` : ""}`);
    }
    const llm = options?.llm ?? new types_1.MockLLMAdapter();
    const runId = options?.runId ??
        `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const { adapterInfo } = llm;
    const log = options?.quiet ? (() => { }) : console.log.bind(console);
    log(`[Engine] Running capability: ${cap.definition.id}@${cap.definition.version}`);
    log(`[Engine] Stage: ${cap.definition.stage}`);
    log(`[Engine] Adapter: ${adapterInfo.adapterId} (${adapterInfo.transport})`);
    log(`[Engine] Model: ${adapterInfo.modelId}`);
    log(`[Engine] Run ID: ${runId}`);
    // Call LLM with prompt + input
    const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    const rawOutput = await llm.complete(cap.prompt, inputStr);
    // Persist raw stdout for every run
    (0, local_1.saveRawOutput)(runId, capabilityId, rawOutput);
    // Parse JSON from response
    const cleaned = extractJson(rawOutput);
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    }
    catch (err) {
        const parseError = err instanceof Error ? err.message : "Unknown parse error";
        // Still save what we can
        const durationMs = Date.now() - startTime;
        const metadata = {
            runId,
            capabilityId,
            capabilityVersion: cap.definition.version,
            adapterId: adapterInfo.adapterId,
            modelId: adapterInfo.modelId,
            transport: adapterInfo.transport,
            timestamp: new Date().toISOString(),
            validated: false,
            validationErrors: [`json_parse_error: ${parseError}`],
            durationMs,
        };
        (0, local_1.saveArtifact)(runId, "metadata", metadata);
        throw new Error(`Failed to parse LLM output as JSON: ${parseError}\nRaw output saved for run: ${runId}`);
    }
    // Validate against the output artifact schema if one exists
    const validator = OUTPUT_VALIDATORS[cap.definition.outputArtifact];
    let validated = false;
    let validationErrors;
    if (validator) {
        const result = validator.safeParse(parsed);
        if (result.success) {
            validated = true;
            parsed = result.data;
        }
        else {
            validationErrors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
            if (!options?.quiet) {
                console.error(`[Engine] Validation failed for ${cap.definition.outputArtifact}:`);
                for (const err of validationErrors) {
                    console.error(`  - ${err}`);
                }
            }
        }
    }
    const durationMs = Date.now() - startTime;
    // Build metadata
    const metadata = {
        runId,
        capabilityId,
        capabilityVersion: cap.definition.version,
        adapterId: adapterInfo.adapterId,
        modelId: adapterInfo.modelId,
        transport: adapterInfo.transport,
        timestamp: new Date().toISOString(),
        validated,
        validationErrors: validationErrors ?? [],
        durationMs,
    };
    // Save artifact, errors, and metadata
    const savedTo = (0, local_1.saveArtifact)(runId, capabilityId, parsed);
    if (validationErrors) {
        (0, local_1.saveArtifact)(runId, `${capabilityId}.errors`, validationErrors);
    }
    (0, local_1.saveArtifact)(runId, "metadata", metadata);
    log(`[Engine] Output saved to: ${savedTo}`);
    log(`[Engine] Validated: ${validated}`);
    log(`[Engine] Duration: ${durationMs}ms`);
    return {
        runId,
        capabilityId,
        version: cap.definition.version,
        output: parsed,
        validated,
        validationErrors,
        savedTo,
        metadata,
    };
}
//# sourceMappingURL=runCapability.js.map