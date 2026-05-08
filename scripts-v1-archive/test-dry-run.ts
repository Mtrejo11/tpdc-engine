#!/usr/bin/env npx ts-node
/**
 * Test runner for the pre-apply safety layer (diff parser + dry-run validator + safety checks).
 *
 * Usage:
 *   npx ts-node scripts/test-dry-run.ts
 *
 * No LLM required — runs entirely against local fixtures and files.
 */

import * as fs from "fs";
import * as path from "path";
import { parseDiff } from "../src/patch/parseDiff";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { defaultSafetyConfig } from "../src/patch/safetyChecks";

const ENGINE_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ENGINE_ROOT, "fixtures/dry-run");

interface Fixture {
  description: string;
  patches: Array<{
    filePath: string;
    operation: "create" | "modify" | "delete";
    diff: string;
  }>;
}

function main() {
  const fixtureFiles = fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(`\n[Dry-Run Test] Found ${fixtureFiles.length} fixtures`);
  console.log(`[Dry-Run Test] Repo root: ${ENGINE_ROOT}\n`);

  const safetyConfig = defaultSafetyConfig(ENGINE_ROOT);
  let allPassed = true;

  for (const file of fixtureFiles) {
    const fixturePath = path.join(FIXTURES_DIR, file);
    const fixture: Fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    console.log(`  ${file}`);
    console.log(`  ${fixture.description}`);
    console.log("");

    // Step 1: Test diff parser on each patch
    console.log("    Diff Parser:");
    for (let i = 0; i < fixture.patches.length; i++) {
      const p = fixture.patches[i];
      const parseResult = parseDiff(p.diff);
      if (parseResult.ok) {
        const hunks = parseResult.patch.hunks.length;
        const adds = parseResult.patch.hunks.reduce(
          (sum, h) => sum + h.lines.filter((l) => l.type === "add").length, 0
        );
        const removes = parseResult.patch.hunks.reduce(
          (sum, h) => sum + h.lines.filter((l) => l.type === "remove").length, 0
        );
        console.log(`      [${i}] ${p.filePath}: parsed OK — ${hunks} hunk(s), +${adds} -${removes}`);
      } else {
        console.log(`      [${i}] ${p.filePath}: parse FAILED — ${parseResult.error.message}`);
      }
    }

    // Step 2: Full dry-run validation
    const patches: PatchInput[] = fixture.patches.map((p) => ({
      filePath: p.filePath,
      operation: p.operation,
      diff: p.diff,
    }));

    const result = dryRunValidate(patches, safetyConfig);

    console.log("");
    console.log("    Dry-Run Result:");
    console.log(`      Safe: ${result.safe}`);
    console.log(`      ${result.summary}`);

    if (result.safetyViolations.length > 0) {
      console.log("      Safety violations:");
      for (const v of result.safetyViolations) {
        console.log(`        [${v.rule}] ${v.filePath || "(global)"}: ${v.detail}`);
      }
    }

    for (const check of result.patchChecks) {
      const icon = check.status === "applicable" ? "[OK]" : "[!!]";
      console.log(`      ${icon} ${check.filePath} (${check.operation}): ${check.status} — ${check.detail}`);
    }

    // Verify expectations
    const expectedResults = getExpectedResults(file);
    const actualStatuses = result.patchChecks.map((c) => c.status);
    const pass = expectedResults.every((exp, i) => actualStatuses[i] === exp);

    if (!pass) {
      console.log(`      UNEXPECTED: expected [${expectedResults}], got [${actualStatuses}]`);
      allPassed = false;
    }

    console.log("");
    console.log("  ─────────────────────────────────────────");
    console.log("");
  }

  // Final summary
  console.log(`  Result: ${allPassed ? "ALL PASSED" : "SOME FAILED"}`);
  console.log("");

  if (!allPassed) process.exitCode = 1;
}

/**
 * Expected statuses per fixture for verification.
 */
function getExpectedResults(fixture: string): string[] {
  switch (fixture) {
    case "01_clean_apply.json":
      return ["applicable"];
    case "02_context_mismatch.json":
      return ["conflict"];
    case "03_malformed_diff.json":
      return ["malformed_diff"];
    case "04_denied_file.json":
      // .env doesn't exist → create is applicable from fs perspective
      // package-lock.json exists but diff content doesn't match → conflict
      // Safety checks catch both as denied files separately
      return ["applicable", "conflict"];
    default:
      return [];
  }
}

main();
