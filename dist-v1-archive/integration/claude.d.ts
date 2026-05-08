/**
 * Claude-facing integration entry point.
 *
 * Single function that Claude Code calls with raw user text.
 * Parses explicit `tpdc:<command>` invocations, dispatches to
 * the engine, and returns formatted output for Claude chat.
 *
 * Does NOT auto-route arbitrary requests. Only explicit invocations
 * are handled.
 */
import { LLMAdapter } from "../runtime/types";
export interface TpdcResponse {
    /** Whether this was a recognized TPDC invocation */
    handled: boolean;
    /** The rendered output (CLI-style, suitable for monospace display) */
    output: string;
    /** Structured result metadata */
    meta?: {
        command: string;
        workflowId?: string;
        verdict?: string;
        score?: number;
        error?: string;
    };
}
export interface TpdcIntegrationOptions {
    /** Override the LLM adapter (default: auto-detect) */
    llm?: LLMAdapter;
    /** Suppress workflow progress logs */
    quiet?: boolean;
}
/**
 * Process a raw text input for TPDC invocations.
 *
 * Returns { handled: false } if the text does not start with `tpdc:`.
 * Returns { handled: true, output: "..." } if it does.
 *
 * This is the single entry point for Claude Code integration.
 */
export declare function handleTpdcInvocation(text: string, options?: TpdcIntegrationOptions): Promise<TpdcResponse>;
/**
 * Check if text is a TPDC invocation without executing it.
 * Useful for routing decisions in a larger system.
 */
export { isTpdcInvocation } from "./parser";
