"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTpdcInvocation = void 0;
exports.handleTpdcInvocation = handleTpdcInvocation;
const parser_1 = require("./parser");
const dispatcher_1 = require("./dispatcher");
const claude_code_adapter_1 = require("../runtime/claude-code-adapter");
const claude_adapter_1 = require("../runtime/claude-adapter");
const agent_sdk_adapter_1 = require("../runtime/agent-sdk-adapter");
const types_1 = require("../runtime/types");
// ── Public API ───────────────────────────────────────────────────────
/**
 * Process a raw text input for TPDC invocations.
 *
 * Returns { handled: false } if the text does not start with `tpdc:`.
 * Returns { handled: true, output: "..." } if it does.
 *
 * This is the single entry point for Claude Code integration.
 */
async function handleTpdcInvocation(text, options = {}) {
    // Quick check: is this even a TPDC invocation?
    if (!(0, parser_1.isTpdcInvocation)(text)) {
        return { handled: false, output: "" };
    }
    // Parse the invocation
    const invocation = (0, parser_1.parseInvocation)(text);
    if (!invocation) {
        // Starts with tpdc: but command is invalid
        const output = formatError(text);
        return { handled: true, output };
    }
    // Create LLM adapter
    const llm = options.llm || createDefaultAdapter();
    // Dispatch
    const result = await (0, dispatcher_1.dispatch)(invocation, {
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
var parser_2 = require("./parser");
Object.defineProperty(exports, "isTpdcInvocation", { enumerable: true, get: function () { return parser_2.isTpdcInvocation; } });
// ── Formatting ───────────────────────────────────────────────────────
function formatForClaude(result) {
    const lines = [];
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
function formatError(text) {
    const commandMatch = text.match(/^tpdc:(\w+)/i);
    const attempted = commandMatch ? commandMatch[1] : "unknown";
    const lines = [];
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
function createDefaultAdapter() {
    const adapterEnv = process.env.TPDC_ADAPTER;
    const model = process.env.TPDC_MODEL || undefined;
    if (adapterEnv === "mock") {
        return new types_1.MockLLMAdapter();
    }
    if (adapterEnv === "sdk") {
        return new agent_sdk_adapter_1.AgentSdkAdapter({ model });
    }
    if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
        return new claude_adapter_1.ClaudeAdapter({ model });
    }
    return new claude_code_adapter_1.ClaudeCodeAdapter({ model });
}
//# sourceMappingURL=claude.js.map