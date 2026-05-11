/**
 * Shared types for MCP tool definitions.
 *
 * Each tool lives in its own file under `src/mcp/tools/` and conforms to
 * `ToolDefinition`. The server (`src/mcp/server.ts`) aggregates them into
 * the registry.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}
