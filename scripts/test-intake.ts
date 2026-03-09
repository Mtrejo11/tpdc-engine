#!/usr/bin/env npx tsx
/**
 * Test runner for the intake capability.
 *
 * Runs all fixtures in fixtures/intake/ through the engine,
 * records pass/fail, and summarizes validation failure categories.
 *
 * Usage:
 *   TPDC_ADAPTER=mock npx tsx scripts/test-intake.ts       # mock (no LLM)
 *   npx tsx scripts/test-intake.ts                          # Claude Code CLI (Max tokens)
 *   TPDC_ADAPTER=api ANTHROPIC_API_KEY=sk-... npx tsx ...   # API direct
 *   TPDC_MODEL=opus npx tsx scripts/test-intake.ts          # override model
 */

import * as fs from "fs";
import * as path from "path";
import { runCapability, RunResult } from "../src/runtime/runCapability";
import { ClaudeAdapter } from "../src/runtime/claude-adapter";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";
import { MockLLMAdapter, LLMAdapter } from "../src/runtime/types";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/intake");

interface FixtureResult {
  fixture: string;
  category: string;
  pass: boolean;
  runId: string;
  durationMs: number;
  error?: string;
  validationErrors?: string[];
}

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;

  if (adapterEnv === "mock") {
    return new MockLLMAdapter();
  }
  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
    return new ClaudeAdapter({ model });
  }
  return new ClaudeCodeAdapter({ model });
}

function inferCategory(filename: string): string {
  if (filename.includes("vague")) return "vague";
  if (filename.includes("semi")) return "semi-structured";
  if (filename.includes("ambiguous")) return "ambiguous";
  if (filename.includes("solution")) return "solution-language";
  return "other";
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
  console.log(`  TPDC Engine — Intake Test Suite`);
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
    const category = inferCategory(label);

    process.stdout.write(`  ${label} ... `);

    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      const result: RunResult = await runCapability("intake", input, { llm });
      console.log = origLog;
      console.error = origErr;

      if (result.validated) {
        console.log(`PASS  (${result.metadata.durationMs}ms)`);
        results.push({
          fixture: label,
          category,
          pass: true,
          runId: result.runId,
          durationMs: result.metadata.durationMs,
        });
      } else {
        console.log(`FAIL  (${result.metadata.durationMs}ms)`);
        results.push({
          fixture: label,
          category,
          pass: false,
          runId: result.runId,
          durationMs: result.metadata.durationMs,
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
      console.log(`ERROR`);
      results.push({
        fixture: label,
        category,
        pass: false,
        runId: "n/a",
        durationMs: 0,
        error: message,
      });
    }
  }

  // Overall summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const avgDuration = results.length > 0 ? Math.round(totalDuration / results.length) : 0;

  console.log(`\n========================================`);
  console.log(`  Results: ${passed}/${results.length} passed, ${failed} failed`);
  console.log(`  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
  console.log(`========================================\n`);

  // Pass rate by category
  const categories = [...new Set(results.map((r) => r.category))].sort();
  console.log(`--- Pass Rate by Category ---\n`);
  const categoryStats: Record<string, { total: number; passed: number; avgMs: number }> = {};
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPassed = catResults.filter((r) => r.pass).length;
    const catAvg = catResults.length > 0
      ? Math.round(catResults.reduce((s, r) => s + r.durationMs, 0) / catResults.length)
      : 0;
    categoryStats[cat] = { total: catResults.length, passed: catPassed, avgMs: catAvg };
    const rate = Math.round((catPassed / catResults.length) * 100);
    console.log(`  ${cat.padEnd(20)} ${catPassed}/${catResults.length} (${rate}%)  avg ${(catAvg / 1000).toFixed(1)}s`);
  }
  console.log();

  // Show failures
  if (failed > 0) {
    console.log(`--- Failures ---\n`);
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ${r.fixture} [${r.category}]:`);
      if (r.error) {
        console.log(`    Error: ${r.error.split("\n")[0]}`);
      }
      if (r.validationErrors) {
        for (const ve of r.validationErrors) {
          console.log(`    - ${ve}`);
        }
      }
      console.log();
    }
  }

  // Validation error categories
  if (allValidationErrors.length > 0) {
    console.log(`--- Top Validation Failure Categories ---\n`);
    const errCategories = categorizeErrors(allValidationErrors);
    const sorted = Object.entries(errCategories).sort(([, a], [, b]) => b - a);
    for (const [category, count] of sorted) {
      console.log(`  ${count}x  ${category}`);
    }
    console.log();
  }

  // Save report
  const reportDir = path.resolve(__dirname, "../artifacts");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `test-intake-${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    adapter: adapterInfo,
    fixtureCount: results.length,
    passed,
    failed,
    passRate: Math.round((passed / results.length) * 100),
    totalDurationMs: totalDuration,
    avgDurationMs: avgDuration,
    categoryStats,
    results: results.map((r) => ({
      fixture: r.fixture,
      category: r.category,
      pass: r.pass,
      runId: r.runId,
      durationMs: r.durationMs,
      error: r.error,
      validationErrors: r.validationErrors,
    })),
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
