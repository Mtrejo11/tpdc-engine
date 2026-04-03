import { LLMAdapter, AdapterInfo } from "./types";
export interface AgentSdkAdapterOptions {
    model?: string;
    maxTokens?: number;
    apiKey?: string;
}
/**
 * LLM adapter that uses the Anthropic SDK with structured tool_use
 * to get clean JSON responses without regex extraction.
 *
 * Opt-in via TPDC_ADAPTER=sdk.
 */
export declare class AgentSdkAdapter implements LLMAdapter {
    private client;
    readonly modelId: string;
    readonly adapterInfo: AdapterInfo;
    private maxTokens;
    constructor(options?: AgentSdkAdapterOptions);
    complete(prompt: string, input: string): Promise<string>;
}
