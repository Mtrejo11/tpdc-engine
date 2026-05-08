"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeAdapter = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class ClaudeAdapter {
    client;
    modelId;
    adapterInfo;
    maxTokens;
    constructor(options) {
        this.client = new sdk_1.default({
            apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
        });
        this.modelId = options?.model ?? "claude-sonnet-4-20250514";
        this.maxTokens = options?.maxTokens ?? 4096;
        this.adapterInfo = {
            adapterId: "claude-api",
            modelId: this.modelId,
            transport: "api",
        };
    }
    async complete(prompt, input) {
        const response = await this.client.messages.create({
            model: this.modelId,
            max_tokens: this.maxTokens,
            system: prompt,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: input,
                        },
                        {
                            type: "text",
                            text: "Respond with ONLY the spec.json content — a single valid JSON object. No markdown fences, no commentary, no spec.md. Just the JSON.",
                        },
                    ],
                },
            ],
        });
        const block = response.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") {
            throw new Error("No text content in LLM response");
        }
        return block.text;
    }
}
exports.ClaudeAdapter = ClaudeAdapter;
//# sourceMappingURL=claude-adapter.js.map