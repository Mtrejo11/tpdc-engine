import { RunResult } from "../runtime/runCapability";
import { LLMAdapter } from "../runtime/types";
export declare function runSingleCapability(capabilityId: string, input: unknown, llm?: LLMAdapter): Promise<RunResult>;
