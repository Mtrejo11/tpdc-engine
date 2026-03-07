import { loadCapability } from "../registry/loader";
import { LLMAdapter, MockLLMAdapter } from "./types";
import { saveArtifact } from "../storage/local";
import * as crypto from "crypto";

export interface RunResult {
  runId: string;
  capabilityId: string;
  version: string;
  output: unknown;
  savedTo: string;
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
  const cap = loadCapability(capabilityId, options?.version);
  if (!cap) {
    throw new Error(`Capability not found: ${capabilityId}${options?.version ? `@${options.version}` : ""}`);
  }

  const llm = options?.llm ?? new MockLLMAdapter();
  const runId = options?.runId ?? `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  console.log(`[Engine] Running capability: ${cap.definition.id}@${cap.definition.version}`);
  console.log(`[Engine] Stage: ${cap.definition.stage}`);
  console.log(`[Engine] Run ID: ${runId}`);

  // Call LLM with prompt + input
  const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  const rawOutput = await llm.complete(cap.prompt, inputStr);

  // Try to parse as JSON
  let output: unknown;
  try {
    output = JSON.parse(rawOutput);
  } catch {
    output = rawOutput;
  }

  // Save artifact
  const savedTo = saveArtifact(runId, capabilityId, output);

  console.log(`[Engine] Output saved to: ${savedTo}`);

  return {
    runId,
    capabilityId,
    version: cap.definition.version,
    output,
    savedTo,
  };
}
