#!/usr/bin/env node
/**
 * tpdc CLI — v2 entry point.
 *
 * Skeleton. Subcommands populate as v2 stages come online.
 * See DECISIONS.md for the planned command surface.
 */

import { VERSION } from "../index.js";
import { runUnblock } from "./unblock.js";

const [command, ...rest] = process.argv.slice(2);

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

    case "unblock":
      await runUnblock(rest);
      return;

    default: {
      const lines = [
        `tpdc v${VERSION} — autonomous dev engine`,
        ``,
        `v2 is in active development. Subcommand surface is being rebuilt.`,
        `See ~/Documents/Claude/Projects/TPDC/DECISIONS.md for the v2 plan.`,
        ``,
        `Available now:`,
        `  tpdc version              Show version`,
        `  tpdc unblock <runId>      Answer pending intake questions, resume workflow`,
        ``,
        `Coming in v2:`,
        `  tpdc ship "<request>"     Run the full pipeline (intake → PR + CI green)`,
        `  tpdc show [<runId>]       Inspect runs`,
      ];
      console.log(lines.join("\n"));
      process.exit(command ? 1 : 0);
    }
  }
}
