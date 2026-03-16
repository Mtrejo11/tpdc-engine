import { LLMAdapter, AdapterInfo } from "./types";
export interface ClaudeAdapterOptions {
    model?: string;
    maxTokens?: number;
    apiKey?: string;
}
export declare class ClaudeAdapter implements LLMAdapter {
    private client;
    readonly modelId: string;
    readonly adapterInfo: AdapterInfo;
    private maxTokens;
    constructor(options?: ClaudeAdapterOptions);
    complete(prompt: string, input: string): Promise<string>;
}
