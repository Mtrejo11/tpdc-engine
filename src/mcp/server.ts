#!/usr/bin/env node
/**
 * TPDC MCP Server — exposes TPDC engine commands as MCP tools.
 *
 * Runs as a stdio MCP server. Claude Code connects to this server
 * and can invoke TPDC tools explicitly.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { dispatch, DispatchResult } from "../integration/dispatcher";
import { parseDevelopArgs } from "../integration/parser";
import { runDevelop } from "../integration/develop";
import { ClaudeCodeAdapter } from "../runtime/claude-code-adapter";
import { ClaudeAdapter } from "../runtime/claude-adapter";
import { MockLLMAdapter, LLMAdapter } from "../runtime/types";

// ── Tool definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: "tpdc_develop",
    description: "End-to-end development workflow. Orchestrates discovery → plan → solve (feature), fix (bug), or refactor. Use when the user wants a complete development cycle.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", enum: ["feature", "bug", "refactor"], description: "Development mode" },
        request: { type: "string", description: "The development request" },
        repo_root: { type: "string", description: "Path to the target repository. Auto-detected from workspace if omitted." },
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        request: { type: "string", description: "Bug description" },
        repo_root: { type: "string", description: "Path to the target repository. Auto-detected from workspace if omitted." },
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
      type: "object" as const,
      properties: {
        request: { type: "string", description: "Refactor request" },
        repo_root: { type: "string", description: "Path to the target repository. Auto-detected from workspace if omitted." },
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
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "Workflow run ID" },
      },
      required: ["run_id"],
    },
  },
];

// ── LLM adapter ──────────────────────────────────────────────────────

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;

  if (adapterEnv === "mock") return new MockLLMAdapter();
  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) return new ClaudeAdapter({ model });
  return new ClaudeCodeAdapter({ model });
}

// ── Repo root auto-detection ─────────────────────────────────────────

let _server: Server | null = null;

async function resolveRepoRoot(explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;

  // Try MCP listRoots to get the client's working directories
  if (_server) {
    try {
      const { roots } = await _server.listRoots();
      if (roots && roots.length > 0) {
        // Use the first root's URI, stripping the file:// prefix
        const uri = roots[0].uri;
        if (uri.startsWith("file://")) {
          return decodeURIComponent(uri.slice(7));
        }
        return uri;
      }
    } catch {
      // listRoots not supported by client — fall through
    }
  }

  return undefined;
}

// ── Tool handlers ────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  const llm = createAdapter();

  switch (name) {
    case "tpdc_develop": {
      const mode = args.mode as string;
      const request = args.request as string;
      const parsed = parseDevelopArgs(`${mode} "${request}"`);
      if (!parsed) return "Error: Invalid develop mode. Use feature, bug, or refactor.";

      const repoRoot = await resolveRepoRoot(args.repo_root as string | undefined);
      const flags = {
        apply: args.apply as boolean | undefined,
        confirmApply: args.confirm_apply as boolean | undefined,
        repoRoot,
      };
      const result = await runDevelop(parsed.mode, parsed.request, flags, { llm, quiet: true });
      return result.output;
    }

    case "tpdc_discovery":
    case "tpdc_assess":
    case "tpdc_plan": {
      const command = name.replace("tpdc_", "");
      const result = await dispatch(
        { command: command as any, args: args.request as string, flags: {} },
        { llm, quiet: true },
      );
      return result.output;
    }

    case "tpdc_solve":
    case "tpdc_fix":
    case "tpdc_refactor": {
      const command = name.replace("tpdc_", "");
      const repoRoot = await resolveRepoRoot(args.repo_root as string | undefined);
      const flags = {
        apply: args.apply as boolean | undefined,
        confirmApply: args.confirm_apply as boolean | undefined,
        repoRoot,
      };
      const result = await dispatch(
        { command: command as any, args: args.request as string, flags },
        { llm, quiet: true },
      );
      return result.output;
    }

    case "tpdc_show": {
      const result = await dispatch(
        { command: "show", args: (args.run_id as string) || "", flags: {} },
        { llm, quiet: true },
      );
      return result.output;
    }

    case "tpdc_diff": {
      const result = await dispatch(
        { command: "diff", args: args.run_id as string, flags: {} },
        { llm, quiet: true },
      );
      return result.output;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Server setup ─────────────────────────────────────────────────────

async function main() {
  const server = new Server(
    { name: "tpdc", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  _server = server;

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const output = await handleTool(name, (args || {}) as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("TPDC MCP server error:", err);
  process.exit(1);
});
