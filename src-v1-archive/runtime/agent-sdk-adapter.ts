import Anthropic from "@anthropic-ai/sdk";
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
export class AgentSdkAdapter implements LLMAdapter {
  private client: Anthropic;
  readonly modelId: string;
  readonly adapterInfo: AdapterInfo;
  private maxTokens: number;

  constructor(options?: AgentSdkAdapterOptions) {
    this.client = new Anthropic({
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

  async complete(prompt: string, input: string): Promise<string> {
    const jsonOutputTool: Anthropic.Tool = {
      name: "json_output",
      description:
        "Return the structured JSON result. Always use this tool to respond.",
      input_schema: {
        type: "object" as const,
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
