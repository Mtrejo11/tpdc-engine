#!/usr/bin/env npx tsx
/**
 * Run fixture 08 three times with ClaudeCodeAdapter and report observable_symptom lengths.
 */

import * as fs from "fs";
import * as path from "path";
import { runCapability, RunResult } from "../src/runtime/runCapability";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";

const FIXTURE = path.resolve(__dirname, "../fixtures/intake/08_ambiguous_orchestrator_boundaries.json");
const RUNS = 3;

async function main() {
  const llm = new ClaudeCodeAdapter({ model: process.env.TPDC_MODEL || "sonnet" });
  const input = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));

  console.log(`\nRunning fixture 08 x${RUNS} with ClaudeCodeAdapter...\n`);

  const results: Array<{
    run: number;
    pass: boolean;
    runId: string;
    durationMs: number;
    symptomLength: number | null;
    symptomText: string | null;
    errors?: string[];
  }> = [];

  for (let i = 1; i <= RUNS; i++) {
    process.stdout.write(`  Run ${i}/${RUNS} ... `);

    // Silence engine logging
    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      const result: RunResult = await runCapability("intake", input, { llm });
      console.log = origLog;
      console.error = origErr;

      const output = result.output as Record<string, unknown>;
      const symptom = typeof output.observable_symptom === "string" ? output.observable_symptom : null;

      if (result.validated) {
        console.log(`PASS  (${result.metadata.durationMs}ms)  symptom: ${symptom?.length ?? "??"} chars`);
      } else {
        console.log(`FAIL  (${result.metadata.durationMs}ms)  symptom: ${symptom?.length ?? "??"} chars`);
      }

      results.push({
        run: i,
        pass: result.validated,
        runId: result.runId,
        durationMs: result.metadata.durationMs,
        symptomLength: symptom?.length ?? null,
        symptomText: symptom,
        errors: result.validationErrors,
      });
    } catch (err) {
      console.log = origLog;
      console.error = origErr;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${message.split("\n")[0]}`);
      results.push({
        run: i,
        pass: false,
        runId: "n/a",
        durationMs: 0,
        symptomLength: null,
        symptomText: null,
        errors: [message],
      });
    }
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n========================================`);
  console.log(`  Fixture 08 Retry Results: ${passed}/${RUNS} passed`);
  console.log(`========================================\n`);

  for (const r of results) {
    console.log(`  Run ${r.run}: ${r.pass ? "PASS" : "FAIL"}  ${r.durationMs}ms  symptom=${r.symptomLength ?? "??"} chars`);
    if (r.symptomText) {
      console.log(`    "${r.symptomText}"`);
    }
    if (r.errors && r.errors.length > 0) {
      for (const e of r.errors) {
        console.log(`    ERROR: ${e}`);
      }
    }
    console.log();
  }

  // Save report
  const reportDir = path.resolve(__dirname, "../artifacts");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `retry-fixture-08-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ results, passed, total: RUNS }, null, 2), "utf-8");
  console.log(`Report saved to: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
