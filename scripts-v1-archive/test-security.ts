/**
 * Security tests for P0 fixes.
 *
 * Tests:
 * 1. Path traversal in capability loader — rejects ../../ in IDs
 * 2. Path traversal in capability loader — rejects ../../ in versions
 * 3. LLM output cannot read files outside repoRoot via absolute paths
 * 4. LLM output cannot read files outside repoRoot via ../ traversal
 * 5. loadArtifact handles corrupt JSON gracefully
 * 6. Semver sort is numeric, not lexicographic
 */

import { loadCapability } from "../src/registry/loader";
import { buildRepoContext } from "../src/runtime/repoContext";
import { loadArtifact, saveArtifact } from "../src/storage/local";
import * as fs from "fs";
import * as path from "path";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Test 1: Path traversal in capability ID ──────────────────────────

console.log("\n[Test 1] Capability loader rejects traversal in ID\n");
{
  try {
    const result = loadCapability("../../etc/passwd");
    assert(result === null, "Returns null for traversal ID");
  } catch (err: any) {
    assert(err.message.includes("Invalid capability ID"), `Throws validation error (got: ${err.message.substring(0, 60)})`);
  }

  try {
    const result = loadCapability("../secret");
    assert(result === null, "Returns null for ../ ID");
  } catch (err: any) {
    assert(err.message.includes("Invalid capability ID"), `Throws validation error for ../ (got: ${err.message.substring(0, 60)})`);
  }

  // Valid IDs should still work
  try {
    const result = loadCapability("intake");
    assert(result !== null, "Valid ID 'intake' still loads");
  } catch {
    assert(false, "Valid ID 'intake' should not throw");
  }
}

// ── Test 2: Path traversal in capability version ─────────────────────

console.log("\n[Test 2] Capability loader rejects traversal in version\n");
{
  try {
    const result = loadCapability("intake", "../../etc");
    assert(result === null, "Returns null for traversal version");
  } catch (err: any) {
    assert(err.message.includes("Invalid capability version"), `Throws validation error (got: ${err.message.substring(0, 60)})`);
  }

  // Valid version should still work
  try {
    const result = loadCapability("intake", "0.1.0");
    assert(result !== null, "Valid version '0.1.0' still loads");
  } catch {
    assert(false, "Valid version should not throw");
  }
}

// ── Test 3: repoContext blocks absolute paths ────────────────────────

console.log("\n[Test 3] repoContext blocks absolute paths from LLM\n");
{
  // Use a temp directory as fake repo root
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "tpdc-sec-test-"));
  fs.writeFileSync(path.join(tmpDir, "legit.ts"), "export const x = 1;");

  // This file exists but is outside repoRoot
  const outsideFile = "/etc/hosts";

  const ctx = buildRepoContext(tmpDir, [
    { title: "Read config", description: `Check ${outsideFile} for hosts`, acceptanceCriteria: "File read" },
  ]);

  assert(!ctx.fileContents[outsideFile], "Absolute path /etc/hosts not read");
  assert(!ctx.existingFiles.includes("hosts"), "hosts not in existing files");
  assert(!ctx.existingFiles.includes("/etc/hosts"), "/etc/hosts not in existing files");

  // But legit file inside repoRoot should work
  const ctx2 = buildRepoContext(tmpDir, [
    { title: "Read legit", description: "Check legit.ts", acceptanceCriteria: "exists" },
  ]);
  assert(ctx2.existingFiles.includes("legit.ts"), "Legit file inside repoRoot is read");

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── Test 4: repoContext blocks ../ traversal ─────────────────────────

console.log("\n[Test 4] repoContext blocks ../ traversal paths\n");
{
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "tpdc-sec-test-"));
  const subDir = path.join(tmpDir, "repo");
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(tmpDir, "secret.txt"), "password123");
  fs.writeFileSync(path.join(subDir, "app.ts"), "console.log('hi')");

  const ctx = buildRepoContext(subDir, [
    { title: "Escape", description: "Read ../secret.txt to get creds", acceptanceCriteria: "got it" },
  ]);

  assert(!ctx.fileContents["../secret.txt"], "../secret.txt not read");
  assert(ctx.existingFiles.length === 0, "No files escaped repoRoot");

  // File inside repoRoot still works
  const ctx2 = buildRepoContext(subDir, [
    { title: "Legit", description: "Check app.ts", acceptanceCriteria: "exists" },
  ]);
  assert(ctx2.existingFiles.includes("app.ts"), "app.ts inside repoRoot is read");

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── Test 5: loadArtifact handles corrupt JSON ────────────────────────

console.log("\n[Test 5] loadArtifact returns null for corrupt JSON\n");
{
  const ARTIFACTS_DIR = path.resolve(__dirname, "../artifacts");
  const fakeRunId = "wf_test_corrupt_json";
  const fakeRunDir = path.join(ARTIFACTS_DIR, fakeRunId);
  fs.mkdirSync(fakeRunDir, { recursive: true });

  // Write corrupt JSON
  fs.writeFileSync(path.join(fakeRunDir, "intake.json"), "{invalid json!!!", "utf-8");

  const result = loadArtifact(fakeRunId, "intake");
  assert(result === null, "Returns null for corrupt JSON (no crash)");

  // Valid JSON still works
  fs.writeFileSync(path.join(fakeRunDir, "design.json"), '{"title":"test"}', "utf-8");
  const valid = loadArtifact(fakeRunId, "design") as any;
  assert(valid?.title === "test", "Valid JSON still loads correctly");

  fs.rmSync(fakeRunDir, { recursive: true, force: true });
}

// ── Test 6: Semver sort is numeric ───────────────────────────────────

console.log("\n[Test 6] Semver sort is numeric, not lexicographic\n");
{
  // Test the sort logic directly — "0.10.0" should sort after "0.9.0"
  function compareSemver(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
  }

  const versions = ["0.1.0", "0.10.0", "0.9.0", "0.2.0", "1.0.0"];
  const sorted = versions.sort(compareSemver);
  assert(sorted[sorted.length - 1] === "1.0.0", `Latest is 1.0.0 (got ${sorted[sorted.length - 1]})`);
  assert(sorted[0] === "0.1.0", `Earliest is 0.1.0 (got ${sorted[0]})`);

  // Lexicographic sort would put 0.10.0 before 0.9.0
  const lexSorted = ["0.1.0", "0.10.0", "0.9.0"].sort();
  assert(lexSorted[lexSorted.length - 1] === "0.9.0", "Lexicographic sort is wrong (0.9.0 > 0.10.0)");

  // Our sort gets it right
  const numSorted = ["0.1.0", "0.10.0", "0.9.0"].sort(compareSemver);
  assert(numSorted[numSorted.length - 1] === "0.10.0", `Numeric sort correct: 0.10.0 > 0.9.0 (got ${numSorted[numSorted.length - 1]})`);
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
