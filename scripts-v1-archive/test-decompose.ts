#!/usr/bin/env npx tsx
/**
 * Test runner for the decompose capability.
 *
 * Runs all fixtures in fixtures/decompose/ through the engine,
 * records pass/fail, and checks blocked vs. actionable status.
 *
 * Usage:
 *   npx tsx scripts/test-decompose.ts                          # Claude Code CLI
 *   TPDC_ADAPTER=mock npx tsx scripts/test-decompose.ts        # mock
 *   TPDC_MODEL=opus npx tsx scripts/test-decompose.ts          # override model
 */

import * as fs from "fs";
import * as path from "path";
import { runCapability, RunResult } from "../src/runtime/runCapability";
import { ClaudeAdapter } from "../src/runtime/claude-adapter";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";
import { MockLLMAdapter, LLMAdapter } from "../src/runtime/types";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/decompose");

interface FixtureResult {
  fixture: string;
  pass: boolean;
  runId: string;
  durationMs: number;
  status?: string;
  stepCount?: number;
  unresolvedCount?: number;
  error?: string;
  validationErrors?: string[];
}

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;
  if (adapterEnv === "mock") return new MockLLMAdapter();
  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) return new ClaudeAdapter({ model });
  return new ClaudeCodeAdapter({ model });
}

function categorizeErrors(errors: string[]): Record<string, number> {
  const categories: Record<string, number> = {};
  for (const err of errors) {
    const colonIdx = err.indexOf(":");
    const field = colonIdx > 0 ? err.substring(0, colonIdx).trim() : "unknown";
    const message = colonIdx > 0 ? err.substring(colonIdx + 1).trim() : err;
    const key = `${field} — ${message}`;
    categories[key] = (categories[key] || 0) + 1;
  }
  return categories;
}

async function main() {
  const llm = createAdapter();
  const { adapterInfo } = llm;
  console.log(`\n========================================`);
  console.log(`  TPDC Engine — Decompose Test Suite`);
  console.log(`  Adapter: ${adapterInfo.adapterId} (${adapterInfo.transport})`);
  console.log(`  Model: ${adapterInfo.modelId}`);
  console.log(`  Fixtures: ${FIXTURES_DIR}`);
  console.log(`========================================\n`);

  const fixtureFiles = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (fixtureFiles.length === 0) {
    console.error("No fixtures found.");
    process.exit(1);
  }

  console.log(`Found ${fixtureFiles.length} fixtures.\n`);

  const results: FixtureResult[] = [];
  const allValidationErrors: string[] = [];

  for (const file of fixtureFiles) {
    const fixturePath = path.join(FIXTURES_DIR, file);
    const input = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const label = file.replace(".json", "");

    process.stdout.write(`  ${label} ... `);

    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      const result: RunResult = await runCapability("decompose", input, { llm });
      console.log = origLog;
      console.error = origErr;

      const output = result.output as Record<string, unknown>;
      const planStatus = output.status as string | undefined;
      const steps = output.steps as unknown[] | undefined;
      const unresolved = output.unresolvedQuestions as unknown[] | undefined;

      const statusLabel = planStatus === "blocked" ? "BLOCKED" : "ACTIONABLE";
      const detail = planStatus === "blocked"
        ? `${unresolved?.length ?? 0} unresolved questions`
        : `${steps?.length ?? 0} steps`;

      if (result.validated) {
        console.log(`PASS  (${result.metadata.durationMs}ms)  ${statusLabel} — ${detail}`);
        results.push({
          fixture: label,
          pass: true,
          runId: result.runId,
          durationMs: result.metadata.durationMs,
          status: planStatus,
          stepCount: steps?.length,
          unresolvedCount: unresolved?.length,
        });
      } else {
        console.log(`FAIL  (${result.metadata.durationMs}ms)  ${statusLabel}`);
        results.push({
          fixture: label,
          pass: false,
          runId: result.runId,
          durationMs: result.metadata.durationMs,
          status: planStatus,
          validationErrors: result.validationErrors,
        });
        if (result.validationErrors) {
          allValidationErrors.push(...result.validationErrors);
        }
      }
    } catch (err) {
      console.log = origLog;
      console.error = origErr;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${message.split("\n")[0]}`);
      results.push({
        fixture: label,
        pass: false,
        runId: "n/a",
        durationMs: 0,
        error: message,
      });
    }
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const blocked = results.filter((r) => r.status === "blocked").length;
  const actionable = results.filter((r) => r.status === "actionable").length;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const avgDuration = results.length > 0 ? Math.round(totalDuration / results.length) : 0;

  console.log(`\n========================================`);
  console.log(`  Results: ${passed}/${results.length} passed, ${failed} failed`);
  console.log(`  Blocked: ${blocked}  |  Actionable: ${actionable}`);
  console.log(`  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
  console.log(`========================================\n`);

  // Show failures
  if (failed > 0) {
    console.log(`--- Failures ---\n`);
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ${r.fixture}:`);
      if (r.error) console.log(`    Error: ${r.error.split("\n")[0]}`);
      if (r.validationErrors) {
        for (const ve of r.validationErrors) console.log(`    - ${ve}`);
      }
      console.log();
    }
  }

  // Validation error categories
  if (allValidationErrors.length > 0) {
    console.log(`--- Top Validation Failure Categories ---\n`);
    const errCategories = categorizeErrors(allValidationErrors);
    for (const [category, count] of Object.entries(errCategories).sort(([, a], [, b]) => b - a)) {
      console.log(`  ${count}x  ${category}`);
    }
    console.log();
  }

  // Save report
  const reportDir = path.resolve(__dirname, "../artifacts");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `test-decompose-${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    adapter: adapterInfo,
    fixtureCount: results.length,
    passed,
    failed,
    passRate: Math.round((passed / results.length) * 100),
    blocked,
    actionable,
    totalDurationMs: totalDuration,
    avgDurationMs: avgDuration,
    results,
    errorCategories: allValidationErrors.length > 0
      ? categorizeErrors(allValidationErrors)
      : undefined,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Report saved to: ${reportPath}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
