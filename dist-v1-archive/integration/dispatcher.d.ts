/**
 * Command dispatcher for TPDC invocations.
 *
 * Maps parsed commands to existing engine functions.
 * Returns structured results suitable for Claude-facing rendering.
 */
import { ParsedInvocation, TpdcCommand } from "./parser";
import { LLMAdapter } from "../runtime/types";
export interface DispatchResult {
    command: TpdcCommand;
    workflowId?: string;
    output: string;
    verdict?: string;
    score?: number;
    error?: string;
}
export interface DispatchOptions {
    llm: LLMAdapter;
    quiet?: boolean;
}
export declare function dispatch(invocation: ParsedInvocation, options: DispatchOptions): Promise<DispatchResult>;
