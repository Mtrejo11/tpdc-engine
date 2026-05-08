#!/usr/bin/env npx ts-node
/**
 * Test runner for execute-patch (patch mode) capability.
 *
 * Usage:
 *   npx ts-node scripts/test-execute-patch.ts
 *   TPDC_ADAPTER=mock npx ts-node scripts/test-execute-patch.ts
 */

import * as fs from "fs";
import * as path from "path";
import { executePatch } from "../src/runtime/executePatch";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";
import { ClaudeAdapter } from "../src/runtime/claude-adapter";
import { MockLLMAdapter, LLMAdapter } from "../src/runtime/types";

const ENGINE_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ENGINE_ROOT, "fixtures/execute-patch");

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;
  if (adapterEnv === "mock") return new MockLLMAdapter();
  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) return new ClaudeAdapter({ model });
  // Patch mode needs more time and budget — file contents make prompts larger
  return new ClaudeCodeAdapter({ model, timeoutMs: 600_000, maxBudgetUsd: 5 });
}

interface FixtureInput {
  plan: Record<string, unknown>;
  repoRoot: string;
  fileHints?: string[];
}

async function main() {
  const llm = createAdapter();
  const fixtureFiles = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(`\n[Execute Patch Test] Found ${fixtureFiles.length} fixtures\n`);
  console.log(`  Adapter: ${llm.adapterInfo.adapterId} (${llm.adapterInfo.transport})`);
  console.log(`  Model:   ${llm.adapterInfo.modelId}\n`);

  const results: Array<{
    fixture: string;
    status: string;
    validated: boolean;
    targetFiles: number;
    patches: number;
    durationMs: number;
    errors?: string[];
  }> = [];

  for (const file of fixtureFiles) {
    const fixturePath = path.join(FIXTURES_DIR, file);
    const raw: FixtureInput = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    // Replace __ENGINE_ROOT__ sentinel with actual path
    const repoRoot = raw.repoRoot === "__ENGINE_ROOT__" ? ENGINE_ROOT : raw.repoRoot;

    console.log(`  ${file.padEnd(40)} running...`);
    const start = Date.now();

    try {
      const result = await executePatch(raw.plan, {
        llm,
        repoRoot,
        fileHints: raw.fileHints,
        quiet: true,
      });

      const durationMs = Date.now() - start;
      const output = result.output as Record<string, unknown>;
      const patches = (output.patches as unknown[]) || [];
      const targetFiles = (output.targetFiles as string[]) || [];

      const entry = {
        fixture: file,
        status: (output.executionStatus as string) || "unknown",
        validated: result.validated,
        targetFiles: targetFiles.length,
        patches: patches.length,
        durationMs,
        errors: result.validationErrors,
      };
      results.push(entry);

      const icon = result.validated ? "PASS" : "FAIL";
      console.log(
        `  ${file.padEnd(40)} ${icon}  status=${entry.status}  ` +
        `files=${entry.targetFiles}  patches=${entry.patches}  (${(durationMs / 1000).toFixed(1)}s)`
      );

      if (result.validationErrors) {
        for (const err of result.validationErrors) {
          console.log(`    ⚠ ${err}`);
        }
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      results.push({
        fixture: file,
        status: "error",
        validated: false,
        targetFiles: 0,
        patches: 0,
        durationMs,
        errors: [message],
      });
      console.log(`  ${file.padEnd(40)} ERROR (${(durationMs / 1000).toFixed(1)}s): ${message}`);
    }
  }

  // Summary
  console.log("\n  ─────────────────────────────────────────");
  const passed = results.filter((r) => r.validated).length;
  console.log(`  Results: ${passed}/${results.length} validated`);

  for (const r of results) {
    console.log(
      `    ${r.validated ? "[OK]" : "[!!]"} ${r.fixture.padEnd(40)} ` +
      `${r.status.padEnd(22)} ${r.patches} patches  ${r.targetFiles} files`
    );
  }
  console.log("");

  // Save report
  const reportPath = path.join(ENGINE_ROOT, "artifacts", `execute-patch-report-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`  Report saved: ${reportPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
