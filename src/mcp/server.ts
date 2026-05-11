#!/usr/bin/env node
/**
 * tpdc-mcp — Claude Code MCP server.
 *
 * Surface (per VISION.md §3):
 *   - Validators: lightweight Zod-parse tools for stage artifacts.
 *   - Heavy operations: agentic loops (execute, run-tests, auto-fix-CI)
 *     and parallel coordination (team-meeting).
 *   - Worktree + git/gh helpers.
 *
 * This file ships as the `tpdc-mcp` bin. Claude Code launches it via stdio.
 *
 * Tools are defined one-per-file under `src/mcp/tools/` and aggregated here.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../index.js";
import { executeTool } from "./tools/execute.js";
import { openPRTool } from "./tools/open-pr.js";
import { pingTool } from "./tools/ping.js";
import { pushTool } from "./tools/push.js";
import { runTestsTool } from "./tools/run-tests.js";
import type { ToolDefinition } from "./tools/types.js";
import { validateIntakeArtifactTool } from "./tools/validate-intake.js";
import { validatePlanArtifactTool } from "./tools/validate-plan.js";

// ── Tool registry ────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  pingTool,
  validateIntakeArtifactTool,
  validatePlanArtifactTool,
  executeTool,
  runTestsTool,
  pushTool,
  openPRTool,
];

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
