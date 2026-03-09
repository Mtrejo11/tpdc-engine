import { loadCapability } from "../registry/loader";
import { LLMAdapter, MockLLMAdapter } from "./types";
import { saveArtifact, saveRawOutput } from "../storage/local";
import { IntakeArtifactSchema } from "tpdc-protocols";
import * as crypto from "crypto";

export interface RunMetadata {
  runId: string;
  capabilityId: string;
  capabilityVersion: string;
  adapterId: string;
  modelId: string;
  transport: string;
  timestamp: string;
  validated: boolean;
  validationErrors: string[];
  durationMs: number;
}

export interface RunResult {
  runId: string;
  capabilityId: string;
  version: string;
  output: unknown;
  validated: boolean;
  validationErrors?: string[];
  savedTo: string;
  metadata: RunMetadata;
}

// Map output artifact names to their Zod schemas for runtime validation
const OUTPUT_VALIDATORS: Record<string, { safeParse: (data: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } }> = {
  IntakeArtifact: IntakeArtifactSchema,
};

function extractJson(raw: string): string {
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

export async function runCapability(
  capabilityId: string,
  input: unknown,
  options?: {
    version?: string;
    llm?: LLMAdapter;
    runId?: string;
  }
): Promise<RunResult> {
  const startTime = Date.now();

  const cap = loadCapability(capabilityId, options?.version);
  if (!cap) {
    throw new Error(
      `Capability not found: ${capabilityId}${options?.version ? `@${options.version}` : ""}`
    );
  }

  const llm = options?.llm ?? new MockLLMAdapter();
  const runId =
    options?.runId ??
    `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const { adapterInfo } = llm;

  console.log(
    `[Engine] Running capability: ${cap.definition.id}@${cap.definition.version}`
  );
  console.log(`[Engine] Stage: ${cap.definition.stage}`);
  console.log(`[Engine] Adapter: ${adapterInfo.adapterId} (${adapterInfo.transport})`);
  console.log(`[Engine] Model: ${adapterInfo.modelId}`);
  console.log(`[Engine] Run ID: ${runId}`);

  // Call LLM with prompt + input
  const inputStr =
    typeof input === "string" ? input : JSON.stringify(input, null, 2);
  const rawOutput = await llm.complete(cap.prompt, inputStr);

  // Persist raw stdout for every run
  saveRawOutput(runId, capabilityId, rawOutput);

  // Parse JSON from response
  const cleaned = extractJson(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const parseError =
      err instanceof Error ? err.message : "Unknown parse error";
    // Still save what we can
    const durationMs = Date.now() - startTime;
    const metadata: RunMetadata = {
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
    saveArtifact(runId, "metadata", metadata);
    throw new Error(
      `Failed to parse LLM output as JSON: ${parseError}\nRaw output saved for run: ${runId}`
    );
  }

  // Validate against the output artifact schema if one exists
  const validator = OUTPUT_VALIDATORS[cap.definition.outputArtifact];
  let validated = false;
  let validationErrors: string[] | undefined;

  if (validator) {
    const result = validator.safeParse(parsed);
    if (result.success) {
      validated = true;
      parsed = result.data;
    } else {
      validationErrors = result.error!.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );
      console.error(`[Engine] Validation failed for ${cap.definition.outputArtifact}:`);
      for (const err of validationErrors!) {
        console.error(`  - ${err}`);
      }
    }
  }

  const durationMs = Date.now() - startTime;

  // Build metadata
  const metadata: RunMetadata = {
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
  const savedTo = saveArtifact(runId, capabilityId, parsed);
  if (validationErrors) {
    saveArtifact(runId, `${capabilityId}.errors`, validationErrors);
  }
  saveArtifact(runId, "metadata", metadata);

  console.log(`[Engine] Output saved to: ${savedTo}`);
  console.log(`[Engine] Validated: ${validated}`);
  console.log(`[Engine] Duration: ${durationMs}ms`);

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
