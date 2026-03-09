#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { listInstalledCapabilities } from "./registry/loader";
import { runCapability } from "./runtime/runCapability";
import { ClaudeAdapter } from "./runtime/claude-adapter";
import { ClaudeCodeAdapter } from "./runtime/claude-code-adapter";
import { MockLLMAdapter, LLMAdapter } from "./runtime/types";

const INSTALLED_DIR = path.resolve(__dirname, "../capabilities/installed");

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;

  if (adapterEnv === "mock") {
    console.log("[Engine] Using MockLLMAdapter (TPDC_ADAPTER=mock)");
    return new MockLLMAdapter();
  }

  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
    console.log(`[Engine] Using ClaudeAdapter (API)${model ? ` (${model})` : ""}`);
    return new ClaudeAdapter({ model });
  }

  // Default: Claude Code CLI — uses Max subscription tokens
  console.log(`[Engine] Using ClaudeCodeAdapter (CLI)${model ? ` (${model})` : ""}`);
  return new ClaudeCodeAdapter({ model });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "install-capability": {
      const sourcePath = args[0];
      if (!sourcePath) {
        console.error("Usage: tpdc-engine install-capability <path-to-bundle>");
        process.exit(1);
      }

      const absSource = path.resolve(sourcePath);
      if (!fs.existsSync(absSource)) {
        console.error(`Source not found: ${absSource}`);
        process.exit(1);
      }

      // Read capability.json from source
      const manifestPath = path.join(absSource, "capability.json");
      if (!fs.existsSync(manifestPath)) {
        console.error("No capability.json found in source directory");
        process.exit(1);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const targetDir = path.join(INSTALLED_DIR, manifest.id, manifest.version);

      // Copy all files
      fs.mkdirSync(targetDir, { recursive: true });
      const files = fs.readdirSync(absSource);
      for (const file of files) {
        const srcFile = path.join(absSource, file);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, path.join(targetDir, file));
        }
      }

      console.log(`Installed: ${manifest.id}@${manifest.version} -> ${targetDir}`);
      break;
    }

    case "list-capabilities": {
      const caps = listInstalledCapabilities();
      if (caps.length === 0) {
        console.log("No capabilities installed.");
      } else {
        console.log("Installed capabilities:\n");
        for (const cap of caps) {
          console.log(`  ${cap.id}@${cap.version} [${cap.stage}] (${cap.status})`);
        }
      }
      break;
    }

    case "run-capability": {
      const capId = args[0];
      const inputArg = args[1];

      if (!capId) {
        console.error("Usage: tpdc-engine run-capability <capability-id> [input-json-or-file]");
        process.exit(1);
      }

      let input: unknown;
      if (inputArg) {
        // Check if it's a file path
        if (fs.existsSync(inputArg)) {
          input = JSON.parse(fs.readFileSync(inputArg, "utf-8"));
        } else {
          // Try parsing as JSON string
          try {
            input = JSON.parse(inputArg);
          } catch {
            // Treat as plain text request
            input = inputArg;
          }
        }
      } else {
        // Read from stdin
        input = "";
      }

      const llm = createAdapter();
      const result = await runCapability(capId, input, { llm });
      console.log("\n--- Result ---");
      console.log(JSON.stringify(result, null, 2));
      if (result.validationErrors) {
        console.error("\nValidation errors found — output may be incomplete.");
        process.exitCode = 2;
      }
      break;
    }

    default:
      console.log("tpdc-engine - Runtime execution engine for TPDC capabilities\n");
      console.log("Commands:");
      console.log("  install-capability <path>    Install a capability bundle");
      console.log("  list-capabilities            List installed capabilities");
      console.log("  run-capability <id> [input]  Run a capability");
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
