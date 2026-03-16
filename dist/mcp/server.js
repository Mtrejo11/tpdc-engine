#!/usr/bin/env node
"use strict";
/**
 * TPDC MCP Server — exposes TPDC engine commands as MCP tools.
 *
 * Runs as a stdio MCP server. Claude Code connects to this server
 * and can invoke TPDC tools explicitly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const dispatcher_1 = require("../integration/dispatcher");
const parser_1 = require("../integration/parser");
const develop_1 = require("../integration/develop");
const claude_code_adapter_1 = require("../runtime/claude-code-adapter");
const claude_adapter_1 = require("../runtime/claude-adapter");
const types_1 = require("../runtime/types");
// ── Tool definitions ─────────────────────────────────────────────────
const TOOLS = [
    {
        name: "tpdc_develop",
        description: "End-to-end development workflow. Orchestrates discovery → plan → solve (feature), fix (bug), or refactor. Use when the user wants a complete development cycle.",
        inputSchema: {
            type: "object",
            properties: {
                mode: { type: "string", enum: ["feature", "bug", "refactor"], description: "Development mode" },
                request: { type: "string", description: "The development request" },
                repo_root: { type: "string", description: "Path to the target repository (required for --apply)" },
                apply: { type: "boolean", description: "Whether to apply patches to the repo" },
                confirm_apply: { type: "boolean", description: "Auto-confirm apply (non-interactive)" },
            },
            required: ["mode", "request"],
        },
    },
    {
        name: "tpdc_discovery",
        description: "Frame a vague idea before execution. Produces problem framing, tradeoffs, readiness assessment, and a suggested next command.",
        inputSchema: {
            type: "object",
            properties: {
                request: { type: "string", description: "The idea or concept to explore" },
            },
            required: ["request"],
        },
    },
    {
        name: "tpdc_assess",
        description: "Analysis/audit mode. Evaluates security, performance, or architecture risks without producing patches.",
        inputSchema: {
            type: "object",
            properties: {
                request: { type: "string", description: "The analysis request" },
            },
            required: ["request"],
        },
    },
    {
        name: "tpdc_plan",
        description: "Technical implementation plan. Produces ordered phases, dependencies, files affected, and validation approach. No patches.",
        inputSchema: {
            type: "object",
            properties: {
                request: { type: "string", description: "What to plan" },
            },
            required: ["request"],
        },
    },
    {
        name: "tpdc_solve",
        description: "Run the full TPDC pipeline for a request. Supports mutation mode with --apply.",
        inputSchema: {
            type: "object",
            properties: {
                request: { type: "string", description: "The request to solve" },
                repo_root: { type: "string", description: "Path to the target repository (required for apply)" },
                apply: { type: "boolean", description: "Whether to apply patches" },
                confirm_apply: { type: "boolean", description: "Auto-confirm apply" },
            },
            required: ["request"],
        },
    },
    {
        name: "tpdc_fix",
        description: "Bug-fix flow with normalization. Extracts platform, component, and behavior from bug reports. Supports mutation mode.",
        inputSchema: {
            type: "object",
            properties: {
                request: { type: "string", description: "Bug description" },
                repo_root: { type: "string", description: "Path to the target repository" },
                apply: { type: "boolean", description: "Whether to apply patches" },
                confirm_apply: { type: "boolean", description: "Auto-confirm apply" },
            },
            required: ["request"],
        },
    },
    {
        name: "tpdc_refactor",
        description: "Structural improvement without changing functional behavior. Supports mutation mode.",
        inputSchema: {
            type: "object",
            properties: {
                request: { type: "string", description: "Refactor request" },
                repo_root: { type: "string", description: "Path to the target repository" },
                apply: { type: "boolean", description: "Whether to apply patches" },
                confirm_apply: { type: "boolean", description: "Auto-confirm apply" },
            },
            required: ["request"],
        },
    },
    {
        name: "tpdc_show",
        description: "Inspect a TPDC workflow run. Without arguments, lists recent runs.",
        inputSchema: {
            type: "object",
            properties: {
                run_id: { type: "string", description: "Workflow run ID (partial match supported). Omit to list recent runs." },
            },
            required: [],
        },
    },
    {
        name: "tpdc_diff",
        description: "Show patch diffs for a mutation run.",
        inputSchema: {
            type: "object",
            properties: {
                run_id: { type: "string", description: "Workflow run ID" },
            },
            required: ["run_id"],
        },
    },
];
// ── LLM adapter ──────────────────────────────────────────────────────
function createAdapter() {
    const adapterEnv = process.env.TPDC_ADAPTER;
    const model = process.env.TPDC_MODEL || undefined;
    if (adapterEnv === "mock")
        return new types_1.MockLLMAdapter();
    if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY)
        return new claude_adapter_1.ClaudeAdapter({ model });
    return new claude_code_adapter_1.ClaudeCodeAdapter({ model });
}
// ── Tool handlers ────────────────────────────────────────────────────
async function handleTool(name, args) {
    const llm = createAdapter();
    switch (name) {
        case "tpdc_develop": {
            const mode = args.mode;
            const request = args.request;
            const parsed = (0, parser_1.parseDevelopArgs)(`${mode} "${request}"`);
            if (!parsed)
                return "Error: Invalid develop mode. Use feature, bug, or refactor.";
            const flags = {
                apply: args.apply,
                confirmApply: args.confirm_apply,
                repoRoot: args.repo_root,
            };
            const result = await (0, develop_1.runDevelop)(parsed.mode, parsed.request, flags, { llm, quiet: true });
            return result.output;
        }
        case "tpdc_discovery":
        case "tpdc_assess":
        case "tpdc_plan": {
            const command = name.replace("tpdc_", "");
            const result = await (0, dispatcher_1.dispatch)({ command: command, args: args.request, flags: {} }, { llm, quiet: true });
            return result.output;
        }
        case "tpdc_solve":
        case "tpdc_fix":
        case "tpdc_refactor": {
            const command = name.replace("tpdc_", "");
            const flags = {
                apply: args.apply,
                confirmApply: args.confirm_apply,
                repoRoot: args.repo_root,
            };
            const result = await (0, dispatcher_1.dispatch)({ command: command, args: args.request, flags }, { llm, quiet: true });
            return result.output;
        }
        case "tpdc_show": {
            const result = await (0, dispatcher_1.dispatch)({ command: "show", args: args.run_id || "", flags: {} }, { llm, quiet: true });
            return result.output;
        }
        case "tpdc_diff": {
            const result = await (0, dispatcher_1.dispatch)({ command: "diff", args: args.run_id, flags: {} }, { llm, quiet: true });
            return result.output;
        }
        default:
            return `Unknown tool: ${name}`;
    }
}
// ── Server setup ─────────────────────────────────────────────────────
async function main() {
    const server = new index_js_1.Server({ name: "tpdc", version: "0.1.0" }, { capabilities: { tools: {} } });
    // List tools
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
        tools: TOOLS,
    }));
    // Call tool
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const output = await handleTool(name, (args || {}));
            return {
                content: [{ type: "text", text: output }],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: "text", text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // Connect via stdio
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("TPDC MCP server error:", err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map