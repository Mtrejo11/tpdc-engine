/**
 * Claude-facing integration entry point.
 *
 * Single function that Claude Code calls with raw user text.
 * Parses explicit `tpdc:<command>` invocations, dispatches to
 * the engine, and returns formatted output for Claude chat.
 *
 * Does NOT auto-route arbitrary requests. Only explicit invocations
 * are handled.
 */

import { parseInvocation, isTpdcInvocation } from "./parser";
import { dispatch, DispatchResult, DispatchOptions } from "./dispatcher";
import { LLMAdapter } from "../runtime/types";
import { ClaudeCodeAdapter } from "../runtime/claude-code-adapter";
import { ClaudeAdapter } from "../runtime/claude-adapter";
import { MockLLMAdapter } from "../runtime/types";

// ── Types ────────────────────────────────────────────────────────────

export interface TpdcResponse {
  /** Whether this was a recognized TPDC invocation */
  handled: boolean;
  /** The rendered output (CLI-style, suitable for monospace display) */
  output: string;
  /** Structured result metadata */
  meta?: {
    command: string;
    workflowId?: string;
    verdict?: string;
    score?: number;
    error?: string;
  };
}

export interface TpdcIntegrationOptions {
  /** Override the LLM adapter (default: auto-detect) */
  llm?: LLMAdapter;
  /** Suppress workflow progress logs */
  quiet?: boolean;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Process a raw text input for TPDC invocations.
 *
 * Returns { handled: false } if the text does not start with `tpdc:`.
 * Returns { handled: true, output: "..." } if it does.
 *
 * This is the single entry point for Claude Code integration.
 */
export async function handleTpdcInvocation(
  text: string,
  options: TpdcIntegrationOptions = {},
): Promise<TpdcResponse> {
  // Quick check: is this even a TPDC invocation?
  if (!isTpdcInvocation(text)) {
    return { handled: false, output: "" };
  }

  // Parse the invocation
  const invocation = parseInvocation(text);

  if (!invocation) {
    // Starts with tpdc: but command is invalid
    const output = formatError(text);
    return { handled: true, output };
  }

  // Create LLM adapter
  const llm = options.llm || createDefaultAdapter();

  // Dispatch
  const result = await dispatch(invocation, {
    llm,
    quiet: options.quiet ?? true,
  });

  // Format for Claude
  const output = formatForClaude(result);

  return {
    handled: true,
    output,
    meta: {
      command: result.command,
      workflowId: result.workflowId,
      verdict: result.verdict,
      score: result.score,
      error: result.error,
    },
  };
}

/**
 * Check if text is a TPDC invocation without executing it.
 * Useful for routing decisions in a larger system.
 */
export { isTpdcInvocation } from "./parser";

// ── Formatting ───────────────────────────────────────────────────────

function formatForClaude(result: DispatchResult): string {
  const lines: string[] = [];

  // The renderer output is already well-formatted CLI text.
  // Wrap it in a code fence for clean monospace rendering in chat.
  lines.push("```");
  lines.push(result.output);
  lines.push("```");

  // Add a one-line status outside the fence for quick scanning
  if (result.verdict) {
    const icon = result.verdict === "pass" ? "✅"
      : result.verdict === "fail" ? "❌"
      : result.verdict === "blocked" ? "⚠️"
      : "❔";
    const scoreStr = result.score !== undefined ? ` — Score: ${result.score}/100` : "";
    lines.push("");
    lines.push(`${icon} **${result.verdict.toUpperCase()}**${scoreStr}`);
  }

  if (result.workflowId) {
    lines.push(`\`${result.workflowId}\``);
  }

  return lines.join("\n");
}

function formatError(text: string): string {
  const commandMatch = text.match(/^tpdc:(\w+)/i);
  const attempted = commandMatch ? commandMatch[1] : "unknown";

  const lines: string[] = [];
  lines.push(`Unknown TPDC command: \`${attempted}\``);
  lines.push("");
  lines.push("Available commands:");
  lines.push("- `tpdc:develop feature|bug|refactor \"<request>\"` — End-to-end workflow");
  lines.push("- `tpdc:discovery \"<idea>\"` — Frame a vague idea before execution");
  lines.push("- `tpdc:assess \"<request>\"` — Analysis/audit mode");
  lines.push("- `tpdc:plan \"<request>\"` — Technical implementation plan");
  lines.push("- `tpdc:solve \"<request>\"` — Run full pipeline");
  lines.push("- `tpdc:fix \"<bug>\"` — Bug-fix flow");
  lines.push("- `tpdc:refactor \"<request>\"` — Structural improvement");
  lines.push("- `tpdc:show [<runId>]` — Inspect a run");
  lines.push("- `tpdc:diff <runId>` — Show patch diff");

  return lines.join("\n");
}

// ── Adapter factory ──────────────────────────────────────────────────

function createDefaultAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;

  if (adapterEnv === "mock") {
    return new MockLLMAdapter();
  }

  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
    return new ClaudeAdapter({ model });
  }

  return new ClaudeCodeAdapter({ model });
}
