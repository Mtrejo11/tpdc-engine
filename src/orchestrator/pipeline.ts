import { runCapability, RunResult } from "../runtime/runCapability";
import { LLMAdapter } from "../runtime/types";

export async function runSingleCapability(
  capabilityId: string,
  input: unknown,
  llm?: LLMAdapter
): Promise<RunResult> {
  return runCapability(capabilityId, input, { llm });
}
