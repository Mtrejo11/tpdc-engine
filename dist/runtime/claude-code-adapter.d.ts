import { LLMAdapter, AdapterInfo } from "./types";
export interface ClaudeCodeAdapterOptions {
    model?: string;
    maxBudgetUsd?: number;
    claudePath?: string;
    timeoutMs?: number;
}
/**
 * LLM adapter that delegates to the Claude Code CLI (`claude --print`).
 * Uses the user's Claude Code Max subscription tokens instead of API credits.
 */
export declare class ClaudeCodeAdapter implements LLMAdapter {
    readonly modelId: string;
    readonly adapterInfo: AdapterInfo;
    private maxBudgetUsd;
    private claudePath;
    private timeoutMs;
    /** Raw stdout from the most recent call. Exposed for persistence. */
    lastRawStdout: string;
    constructor(options?: ClaudeCodeAdapterOptions);
    private verifyBinary;
    complete(prompt: string, input: string): Promise<string>;
}
