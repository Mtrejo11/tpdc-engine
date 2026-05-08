"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentSdkAdapter = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
/**
 * LLM adapter that uses the Anthropic SDK with structured tool_use
 * to get clean JSON responses without regex extraction.
 *
 * Opt-in via TPDC_ADAPTER=sdk.
 */
class AgentSdkAdapter {
    client;
    modelId;
    adapterInfo;
    maxTokens;
    constructor(options) {
        this.client = new sdk_1.default({
            apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
        });
        this.modelId = options?.model ?? "claude-sonnet-4-20250514";
        this.maxTokens = options?.maxTokens ?? 16384;
        this.adapterInfo = {
            adapterId: "agent-sdk",
            modelId: this.modelId,
            transport: "api",
        };
    }
    async complete(prompt, input) {
        const jsonOutputTool = {
            name: "json_output",
            description: "Return the structured JSON result. Always use this tool to respond.",
            input_schema: {
                type: "object",
                additionalProperties: true,
            },
        };
        const response = await this.client.messages.create({
            model: this.modelId,
            max_tokens: this.maxTokens,
            system: prompt,
            tools: [jsonOutputTool],
            tool_choice: { type: "tool", name: "json_output" },
            messages: [
                {
                    role: "user",
                    content: input,
                },
            ],
        });
        // Extract structured JSON directly from tool_use block
        const toolBlock = response.content.find((b) => b.type === "tool_use");
        if (toolBlock && toolBlock.type === "tool_use") {
            return JSON.stringify(toolBlock.input, null, 2);
        }
        // Fallback: return text content if tool_use not present
        const textBlock = response.content.find((b) => b.type === "text");
        if (textBlock && textBlock.type === "text") {
            return textBlock.text;
        }
        throw new Error("No usable content in LLM response");
    }
}
exports.AgentSdkAdapter = AgentSdkAdapter;
//# sourceMappingURL=agent-sdk-adapter.js.map