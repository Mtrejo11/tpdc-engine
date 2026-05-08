import Anthropic from "@anthropic-ai/sdk";
import { LLMAdapter, AdapterInfo } from "./types";

export interface ClaudeAdapterOptions {
  model?: string;
  maxTokens?: number;
  apiKey?: string;
}

export class ClaudeAdapter implements LLMAdapter {
  private client: Anthropic;
  readonly modelId: string;
  readonly adapterInfo: AdapterInfo;
  private maxTokens: number;

  constructor(options?: ClaudeAdapterOptions) {
    this.client = new Anthropic({
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

  async complete(prompt: string, input: string): Promise<string> {
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
