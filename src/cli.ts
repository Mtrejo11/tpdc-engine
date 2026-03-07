#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { listInstalledCapabilities } from "./registry/loader";
import { runCapability } from "./runtime/runCapability";

const INSTALLED_DIR = path.resolve(__dirname, "../capabilities/installed");

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

      const result = await runCapability(capId, input);
      console.log("\n--- Result ---");
      console.log(JSON.stringify(result, null, 2));
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
