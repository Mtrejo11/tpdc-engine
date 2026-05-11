/**
 * tpdc_ping — health-check MCP tool.
 *
 * Used to validate that Claude Code → stdio → MCP plumbing works during
 * plugin setup. Returns the server version and optionally echoes a message.
 */

import { VERSION } from "../../index.js";
import type { ToolDefinition } from "./types.js";

export const pingTool: ToolDefinition = {
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
