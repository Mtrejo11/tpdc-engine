export interface AdapterInfo {
    adapterId: string;
    modelId: string;
    transport: "mock" | "api" | "cli";
}
export interface LLMAdapter {
    readonly adapterInfo: AdapterInfo;
    readonly modelId: string;
    complete(prompt: string, input: string): Promise<string>;
}
export declare class MockLLMAdapter implements LLMAdapter {
    readonly modelId = "mock";
    readonly adapterInfo: AdapterInfo;
    complete(prompt: string, input: string): Promise<string>;
}
