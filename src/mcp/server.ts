#!/usr/bin/env node
/**
 * tpdc-mcp — Claude Code MCP server (v0.3 pivot scaffold).
 *
 * Surface (per VISION.md §3):
 *   - Validators: lightweight Zod-parse tools for stage artifacts.
 *   - Heavy operations: agentic loops (execute, run-tests, auto-fix-CI)
 *     and parallel coordination (team-meeting).
 *   - Worktree + git/gh helpers.
 *
 * This file ships as the `tpdc-mcp` bin. Claude Code launches it via stdio.
 *
 * v0.3.0-alpha.0 is the scaffold: only the `tpdc_ping` health tool is wired
 * to validate the plumbing end-to-end. Real tools land in alpha.1+.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../index.js";

// ── Tool registry ────────────────────────────────────────────────────

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * Scaffold ping tool. Returns server version + an optional echoed message.
 * Used to validate that Claude Code → stdio → MCP plumbing works before we
 * register real tools in alpha.1.
 */
const pingTool: ToolDefinition = {
  name: "tpdc_ping",
  description:
    "Health check for the tpdc-mcp server. Returns server version and " +
    "optionally echoes a message. Use to confirm Claude Code can reach the " +
    "MCP server during plugin setup.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Optional string echoed back in the response.",
      },
    },
  },
  handler: async (args) => {
    const message = typeof args["message"] === "string" ? args["message"] : "";
    const echoed = message ? ` echo: ${message}` : "";
    return {
      content: [
        {
          type: "text",
          text: `tpdc-mcp v${VERSION} alive${echoed}`,
        },
      ],
    };
  },
};

const TOOLS: ToolDefinition[] = [pingTool];

// ── Server wiring ────────────────────────────────────────────────────

export function buildServer(): Server {
  const server = new Server(
    {
      name: "tpdc-mcp",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      const result: CallToolResult = {
        content: [
          {
            type: "text",
            text: `Error: unknown tool "${req.params.name}". Known tools: ${TOOLS.map((t) => t.name).join(", ")}.`,
          },
        ],
        isError: true,
      };
      return result;
    }
    try {
      return await tool.handler(req.params.arguments ?? {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result: CallToolResult = {
        content: [
          {
            type: "text",
            text: `Error in ${tool.name}: ${msg}`,
          },
        ],
        isError: true,
      };
      return result;
    }
  });

  return server;
}

// ── Entry point ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run main() when invoked directly (not when imported by tests).
// In NodeNext ESM, `import.meta.url` matches `process.argv[1]` when the
// file is the entry point.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/mcp/server.js") ||
  process.argv[1]?.endsWith("/mcp/server.ts");

if (invokedDirectly) {
  main().catch((err) => {
    console.error("tpdc-mcp fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
