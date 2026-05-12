/**
 * Executor primitive — TPDC v2.
 *
 * Wraps the Anthropic Messages API with structured outputs (Zod-validated),
 * usage tracking, and model selection. Every stage uses this; advisor
 * consults reuse the same primitive with a more capable model.
 *
 * Key design notes:
 *   - Uses `messages.parse()` + `zodOutputFormat()` from the SDK (v0.78+).
 *     Anthropic does the JSON schema enforcement at generation time and
 *     parses the response against the Zod schema. No regex extraction.
 *   - Default model is Sonnet 4.6 (interleaved thinking automático,
 *     1M context, token-efficient tool use built-in).
 *   - Returns usage/model so callers can track cost and audit.
 *
 * References:
 *   DECISIONS.md §D1 (stack), §"Decisiones derivadas" (Sonnet 4.6 default)
 *   research/07-platform-docs-targeted.md §10 (structured outputs)
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  OutputConfig,
  ThinkingConfigParam,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { ZodType, infer as zInfer } from "zod";

export const DEFAULT_EXECUTOR_MODEL = "claude-sonnet-4-6";
/**
 * Bumped to Opus 4.7 in v0.3.0-alpha.8 to match the platform's recommended
 * pairing for the advisor tool (`advisor-tool-2026-03-01`). Used both by
 * the legacy `consultAdvisor` pattern (two-call escalation) and by the
 * platform advisor tool wired into `execute.ts`.
 */
export const DEFAULT_ADVISOR_MODEL = "claude-opus-4-7";
export const DEFAULT_MAX_TOKENS = 4096;

export interface ExecutorRequest<S extends ZodType> {
  systemPrompt: string;
  userInput: string;
  outputSchema: S;
  /** Override model. Defaults to DEFAULT_EXECUTOR_MODEL. */
  model?: string;
  /** Override max output tokens. Defaults to 4096. */
  maxTokens?: number;
  /** Optional client override (for tests). */
  client?: Anthropic;
  /**
   * Optional extended-thinking configuration (v0.4.0-alpha.12+).
   *
   * For current Opus / Sonnet 4.x models the API expects
   * `{ type: "adaptive" }` plus `thinkingOutputEffort` (mapped into
   * `output_config.effort`), not legacy `{ type: "enabled", budget_tokens }`.
   *
   * Use sparingly on one-shot steps (e.g. team-meeting moderator), not
   * per-turn agent loops.
   */
  thinking?: ThinkingConfigParam;
  /**
   * When `thinking.type` is `"adaptive"`, merged into `output_config.effort`
   * alongside the Zod `format`. Ignored for other thinking shapes.
   */
  thinkingOutputEffort?: NonNullable<OutputConfig["effort"]>;
}

export interface ExecutorResult<T> {
  output: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** The model id Anthropic actually served (may differ from request) */
  model: string;
  /** Raw stop reason for debugging */
  stopReason: string | null;
}

/**
 * Run the executor on a single LLM turn with a Zod-typed structured output.
 *
 * Throws:
 *   - AnthropicError if the model output fails JSON parsing or schema validation
 *   - APIError on network/auth/rate-limit errors
 *   - Error if the response has no parsed output
 */
export async function runExecutor<S extends ZodType>(
  req: ExecutorRequest<S>,
): Promise<ExecutorResult<zInfer<S>>> {
  const client = req.client ?? new Anthropic();
  const model = req.model ?? DEFAULT_EXECUTOR_MODEL;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;

  const outputEffort =
    req.thinking?.type === "adaptive"
      ? (req.thinkingOutputEffort ?? "high")
      : undefined;

  const response = await client.messages.parse({
    model,
    max_tokens: maxTokens,
    system: req.systemPrompt,
    messages: [{ role: "user", content: req.userInput }],
    output_config: {
      format: zodOutputFormat(req.outputSchema),
      ...(outputEffort != null ? { effort: outputEffort } : {}),
    },
    ...(req.thinking ? { thinking: req.thinking } : {}),
  });

  if (response.parsed_output == null) {
    throw new Error(
      `Executor returned no parsed output (stop_reason=${response.stop_reason}). ` +
        `This is unexpected when output_config.format is set.`,
    );
  }

  return {
    output: response.parsed_output as zInfer<S>,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model: response.model,
    stopReason: response.stop_reason,
  };
}
