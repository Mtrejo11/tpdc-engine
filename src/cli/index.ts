#!/usr/bin/env node
/**
 * tpdc CLI — v3 entry point.
 *
 * The v0.2 surface (`tpdc unblock`) is archived in `src-v2-inngest-archive/`
 * because the new form factor (plugin/MCP per VISION.md) handles unblocks
 * via Claude Code chat, not a CLI invocation.
 *
 * v0.3 subcommands are added as the MCP server lands.
 */

import { VERSION } from "../index.js";

const [command] = process.argv.slice(2);

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function main(): Promise<void> {
  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(`tpdc v${VERSION}`);
      return;

    default: {
      const lines = [
        `tpdc v${VERSION} — autonomous dev engine (plugin/MCP for Claude Code)`,
        ``,
        `v0.3 pivot in progress: TPDC now ships as a Claude Code plugin + MCP server.`,
        `See ~/Documents/Claude/Projects/TPDC/VISION.md for the locked architecture.`,
        ``,
        `Available now:`,
        `  tpdc version              Show version`,
        ``,
        `Coming in v0.3:`,
        `  tpdc-mcp                  Start the MCP stdio server (used by Claude Code)`,
      ];
      console.log(lines.join("\n"));
      process.exit(command ? 1 : 0);
    }
  }
}
