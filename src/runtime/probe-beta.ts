/**
 * Beta-capability probe helper (v0.4.0-alpha.12, chapter v0.6 opener).
 *
 * Sends a minimal `messages.create` / `beta.messages.create` request with
 * the target capability configuration and reports whether the platform
 * accepted it. Lets us validate API acceptance BEFORE wiring a capability
 * into the agent loop — instead of after a dogfood breaks.
 *
 * History this formalizes:
 *   - alpha.4 hotfix: `memory-tool-2025-08-18` beta header was sent
 *     conservatively in alpha.1, then rejected mid-run. Probe would have
 *     caught it pre-wireup.
 *   - alpha.10 hotfix: `compact_20260112` edit type was wired in alpha.8
 *     based on SDK 0.78 types, then rejected during dogfood-007. Probe
 *     would have caught it pre-wireup.
 *
 * The probe is deliberately tiny:
 *   - 1-turn user message ("ping").
 *   - Default max_tokens (2048) — enough for a short reply; adaptive
 *     thinking uses `output_config.effort` (no fixed token budget).
 *   - System message is a single token to keep cost negligible.
 *
 * Usage (from a gated integration test):
 *
 *   const ok = await probeBetaConfig({
 *     model: "claude-opus-4-7",
 *     thinking: { type: "adaptive" },
 *   });
 *   expect(ok.ok).toBe(true);
 *
 * Failure shape returns the API's error message so a test failure
 * surfaces the rejection reason directly.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  OutputConfig,
  ThinkingConfigParam,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import type {
  BetaContextManagementConfig,
  BetaThinkingConfigParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

function probeAdaptiveOutputConfig(opts: ProbeBetaConfigOptions): {
  output_config?: { effort: NonNullable<OutputConfig["effort"]> };
} {
  const gaAdaptive = opts.thinking?.type === "adaptive";
  const betaAdaptive = opts.betaThinking?.type === "adaptive";
  if (!gaAdaptive && !betaAdaptive) return {};
  const effort = opts.thinkingOutputEffort ?? "high";
  return { output_config: { effort } };
}

/** Defaults sized for the cheapest probe that can still exercise thinking. */
const PROBE_MAX_TOKENS = 2048;
const PROBE_USER_MESSAGE = "ping";
const PROBE_SYSTEM_MESSAGE = "Reply with one word.";

export interface ProbeBetaConfigOptions {
  /** Override Anthropic client (tests). Defaults to `new Anthropic()`. */
  client?: Anthropic;
  /** Model id to probe. Required — the rejection reason often depends on the model. */
  model: string;
  /**
   * Beta headers to send. Probe automatically picks the `beta.messages.create`
   * surface when this is non-empty; otherwise uses the GA `messages.create`.
   */
  betas?: string[];
  /** Extended thinking config to probe (GA `messages.create`). */
  thinking?: ThinkingConfigParam;
  /**
   * When probing `thinking: { type: "adaptive" }`, sent as
   * `output_config.effort` (required by the platform alongside adaptive).
   */
  thinkingOutputEffort?: NonNullable<OutputConfig["effort"]>;
  /** Beta-namespaced thinking config (use when sending betas). */
  betaThinking?: BetaThinkingConfigParam;
  /** Context management config (alpha.10 probe target). */
  contextManagement?: BetaContextManagementConfig;
  /** Tools to include (e.g., to probe a new beta tool). */
  tools?: ReadonlyArray<BetaToolUnion>;
  /** Override max_tokens. Default 2048 (enough for thinking + small reply). */
  maxTokens?: number;
}

export type ProbeResult =
  | {
      ok: true;
      /** Model id the platform actually served. */
      model: string;
      /** Stop reason — useful for distinguishing 'end_turn' from 'max_tokens'. */
      stopReason: string | null;
    }
  | {
      ok: false;
      /** Human-readable error message (API error or thrown exception). */
      error: string;
      /** HTTP-style status when the error came from the API; undefined otherwise. */
      status?: number;
    };

/**
 * Probe whether the API accepts a given beta capability configuration.
 *
 * Never throws — failures come back as `{ ok: false, error }` so callers
 * (typically integration tests) can assert on the rejection shape.
 */
export async function probeBetaConfig(
  opts: ProbeBetaConfigOptions,
): Promise<ProbeResult> {
  const client = opts.client ?? new Anthropic();
  const maxTokens = opts.maxTokens ?? PROBE_MAX_TOKENS;

  try {
    if (opts.betas && opts.betas.length > 0) {
      // `stream: false` narrows the SDK's union return type from
      // `BetaMessage | Stream<...>` down to `BetaMessage`. We let TS
      // infer the param type from the object literal directly so the
      // discriminant picks the non-streaming overload — declaring a
      // separate variable with an explicit type defeats the narrowing.
      const response = await client.beta.messages.create({
        model: opts.model,
        max_tokens: maxTokens,
        system: PROBE_SYSTEM_MESSAGE,
        messages: [{ role: "user", content: PROBE_USER_MESSAGE }],
        betas: opts.betas,
        stream: false,
        ...probeAdaptiveOutputConfig(opts),
        ...(opts.betaThinking ? { thinking: opts.betaThinking } : {}),
        ...(opts.contextManagement ? { context_management: opts.contextManagement } : {}),
        ...(opts.tools && opts.tools.length > 0
          ? { tools: opts.tools as BetaToolUnion[] }
          : {}),
      });
      return { ok: true, model: response.model, stopReason: response.stop_reason };
    }

    const response = await client.messages.create({
      model: opts.model,
      max_tokens: maxTokens,
      system: PROBE_SYSTEM_MESSAGE,
      messages: [{ role: "user", content: PROBE_USER_MESSAGE }],
      stream: false,
      ...probeAdaptiveOutputConfig(opts),
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
    });
    return { ok: true, model: response.model, stopReason: response.stop_reason };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: err.message, status: err.status };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
