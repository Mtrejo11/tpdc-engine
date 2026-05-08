#!/usr/bin/env npx ts-node
/**
 * Run dry-run validation against a real PatchArtifact from a previous execute-patch run.
 *
 * Usage:
 *   npx ts-node scripts/test-dry-run-artifact.ts <runId>
 */

import * as path from "path";
import { loadArtifact } from "../src/storage/local";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { defaultSafetyConfig } from "../src/patch/safetyChecks";

const ENGINE_ROOT = path.resolve(__dirname, "..");

function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: npx ts-node scripts/test-dry-run-artifact.ts <runId>");
    process.exit(1);
  }

  const artifact = loadArtifact(runId, "execute-patch") as Record<string, unknown> | null;
  if (!artifact) {
    console.error(`No execute-patch artifact found for run: ${runId}`);
    process.exit(1);
  }

  const patches = artifact.patches as Array<{
    filePath: string;
    operation: "create" | "modify" | "delete";
    diff: string;
  }>;

  if (!patches || patches.length === 0) {
    console.log(`PatchArtifact has no patches (status: ${artifact.executionStatus})`);
    process.exit(0);
  }

  console.log(`\n[Dry-Run] Validating PatchArtifact from run: ${runId}`);
  console.log(`[Dry-Run] ${patches.length} patches, status: ${artifact.executionStatus}\n`);

  const safetyConfig = defaultSafetyConfig(ENGINE_ROOT);
  const patchInputs: PatchInput[] = patches.map((p) => ({
    filePath: p.filePath,
    operation: p.operation,
    diff: p.diff,
  }));

  const result = dryRunValidate(patchInputs, safetyConfig);

  console.log(`  Safe: ${result.safe}`);
  console.log(`  ${result.summary}\n`);

  for (const check of result.patchChecks) {
    const icon = check.status === "applicable" ? "[OK]" : "[!!]";
    console.log(`  ${icon} ${check.filePath} (${check.operation}): ${check.status}`);
    console.log(`      ${check.detail}`);
  }

  if (result.safetyViolations.length > 0) {
    console.log("\n  Safety violations:");
    for (const v of result.safetyViolations) {
      console.log(`    [${v.rule}] ${v.filePath}: ${v.detail}`);
    }
  }

  console.log("");
}

main();
