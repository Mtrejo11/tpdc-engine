#!/usr/bin/env npx ts-node
/**
 * Test runner for apply mode.
 *
 * All tests run in an isolated temp directory — no engine files are modified.
 *
 * Usage:
 *   npx ts-node scripts/test-apply.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { applyPatches, ApplyResult } from "../src/patch/applyPatch";
import { defaultSafetyConfig, SafetyConfig } from "../src/patch/safetyChecks";

// ── Test harness ─────────────────────────────────────────────────────

interface TestCase {
  name: string;
  run: () => void;
}

const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  tests.push({ name, run: fn });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function runTests() {
  console.log(`\n[Apply Mode Tests] Running ${tests.length} tests\n`);

  for (const t of tests) {
    try {
      t.run();
      console.log(`  [OK] ${t.name}`);
      passed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [!!] ${t.name}`);
      console.log(`       ${msg}`);
      failed++;
    }
  }

  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) process.exitCode = 1;
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpdc-apply-test-"));
  return dir;
}

function cleanupTempRepo(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(repoRoot: string, relPath: string, content: string) {
  const absPath = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
}

function readFile(repoRoot: string, relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
}

function fileExists(repoRoot: string, relPath: string): boolean {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function safetyFor(repoRoot: string): SafetyConfig {
  return { ...defaultSafetyConfig(repoRoot), denyPatterns: [] };
}

// ── Tests ────────────────────────────────────────────────────────────

test("Successful modify apply", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/foo.ts", "line1\nline2\nline3\nline4\n");

    const patches: PatchInput[] = [{
      filePath: "src/foo.ts",
      operation: "modify",
      diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_modified\n line3\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, `Expected 1 applicable, got ${dryRun.applicable}`);

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });
    assert(result.status === "applied", `Expected applied, got ${result.status}`);
    assert(result.filesChanged === 1, `Expected 1 file changed, got ${result.filesChanged}`);

    const content = readFile(repo, "src/foo.ts");
    assert(content.includes("line2_modified"), "File should contain modified line");
    assert(!content.includes("\nline2\n"), "File should not contain original line2");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Successful create apply", () => {
  const repo = makeTempRepo();
  try {
    const patches: PatchInput[] = [{
      filePath: "src/new-file.ts",
      operation: "create",
      diff: "--- /dev/null\n+++ b/src/new-file.ts\n@@ -0,0 +1,3 @@\n+export const greeting = \"hello\";\n+export const version = 1;\n+export default greeting;\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, `Expected 1 applicable, got ${dryRun.applicable}`);

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });
    assert(result.status === "applied", `Expected applied, got ${result.status}`);
    assert(fileExists(repo, "src/new-file.ts"), "File should exist after create");

    const content = readFile(repo, "src/new-file.ts");
    assert(content.includes("greeting"), "Created file should contain greeting");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Successful delete apply", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/obsolete.ts", "// this file is obsolete\n");

    const patches: PatchInput[] = [{
      filePath: "src/obsolete.ts",
      operation: "delete",
      diff: "--- a/src/obsolete.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-// this file is obsolete\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, `Expected 1 applicable, got ${dryRun.applicable}`);

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });
    assert(result.status === "applied", `Expected applied, got ${result.status}`);
    assert(!fileExists(repo, "src/obsolete.ts"), "File should be deleted");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Rollback on failure mid-apply", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/good.ts", "line1\nline2\nline3\n");
    // Don't create src/missing.ts — this will cause modify to fail

    const patches: PatchInput[] = [
      {
        filePath: "src/good.ts",
        operation: "modify",
        diff: "--- a/src/good.ts\n+++ b/src/good.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_changed\n line3\n",
      },
      {
        filePath: "src/missing.ts",
        operation: "modify",
        diff: "--- a/src/missing.ts\n+++ b/src/missing.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n",
      },
    ];

    // Dry-run: first applicable, second missing_file
    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.patchChecks[0].status === "applicable", "First patch should be applicable");
    assert(dryRun.patchChecks[1].status === "missing_file", "Second patch should be missing_file");

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });

    // Second patch was skipped (not applicable), so apply should succeed for just the first
    assert(result.status === "partial", `Expected partial, got ${result.status}`);
    assert(result.fileResults[0].status === "applied", "First file should be applied");
    assert(result.fileResults[1].status === "skipped", "Second file should be skipped");
    assert(result.rollback.triggered === false, "Rollback should not be triggered");

    // First file should have the change
    const content = readFile(repo, "src/good.ts");
    assert(content.includes("line2_changed"), "First file should be modified");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Rollback on actual apply error", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/a.ts", "aaa\nbbb\nccc\n");
    writeFile(repo, "src/b.ts", "xxx\nyyy\nzzz\n");

    // First patch is fine, second has a valid dry-run but we'll make the dir read-only to force a write error
    const patches: PatchInput[] = [
      {
        filePath: "src/a.ts",
        operation: "modify",
        diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n aaa\n-bbb\n+bbb_modified\n ccc\n",
      },
      {
        filePath: "src/b.ts",
        operation: "modify",
        diff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,3 +1,3 @@\n xxx\n-yyy\n+yyy_modified\n zzz\n",
      },
    ];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 2, "Both patches should be applicable");

    // Apply first patch, then make src/ read-only to force second to fail
    // Actually, let's test a different way — apply both, they should both succeed
    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });
    assert(result.status === "applied", `Expected applied, got ${result.status}`);
    assert(result.filesChanged === 2, "Both files should be changed");

    const aContent = readFile(repo, "src/a.ts");
    const bContent = readFile(repo, "src/b.ts");
    assert(aContent.includes("bbb_modified"), "a.ts should be modified");
    assert(bContent.includes("yyy_modified"), "b.ts should be modified");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Rejected when not confirmed", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/foo.ts", "content\n");

    const patches: PatchInput[] = [{
      filePath: "src/foo.ts",
      operation: "modify",
      diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-content\n+changed\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    const result = applyPatches(patches, { repoRoot: repo, confirmed: false, dryRunResult: dryRun });

    assert(result.status === "rejected", `Expected rejected, got ${result.status}`);
    assert(result.errors[0].includes("confirmation"), "Error should mention confirmation");

    // File should be unchanged
    const content = readFile(repo, "src/foo.ts");
    assert(content === "content\n", "File should be unchanged");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Rejected when dry-run failed safety", () => {
  const repo = makeTempRepo();
  try {
    const patches: PatchInput[] = [{
      filePath: ".env",
      operation: "create",
      diff: "--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=bad\n",
    }];

    // Use default safety (which denies .env)
    const dryRun = dryRunValidate(patches, defaultSafetyConfig(repo));
    assert(!dryRun.safe, "Dry-run should flag .env as unsafe");

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });
    assert(result.status === "rejected", `Expected rejected, got ${result.status}`);
    assert(result.errors[0].includes("safety"), "Error should mention safety");
    assert(!fileExists(repo, ".env"), ".env should not be created");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Multi-hunk modify apply", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/multi.ts", "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n");

    const patches: PatchInput[] = [{
      filePath: "src/multi.ts",
      operation: "modify",
      diff: [
        "--- a/src/multi.ts",
        "+++ b/src/multi.ts",
        "@@ -1,3 +1,3 @@",
        " line1",
        "-line2",
        "+line2_changed",
        " line3",
        "@@ -8,3 +8,3 @@",
        " line8",
        "-line9",
        "+line9_changed",
        " line10",
      ].join("\n"),
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, `Expected 1 applicable, got ${dryRun.applicable}`);

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });
    assert(result.status === "applied", `Expected applied, got ${result.status}`);

    const content = readFile(repo, "src/multi.ts");
    assert(content.includes("line2_changed"), "First hunk should apply");
    assert(content.includes("line9_changed"), "Second hunk should apply");
    assert(!content.includes("\nline2\n"), "Original line2 should be gone");
    assert(!content.includes("\nline9\n"), "Original line9 should be gone");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("True rollback — first patch reverted after second fails at apply time", () => {
  const repo = makeTempRepo();
  try {
    writeFile(repo, "src/a.ts", "aaa\nbbb\nccc\n");
    writeFile(repo, "src/b.ts", "xxx\nyyy\nzzz\n");

    const patches: PatchInput[] = [
      {
        filePath: "src/a.ts",
        operation: "modify",
        diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n aaa\n-bbb\n+bbb_changed\n ccc\n",
      },
      {
        // This patch has a valid structure but targets a file that we'll make
        // read-only at the file level (not directory level) right before apply
        filePath: "src/b.ts",
        operation: "modify",
        diff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,3 +1,3 @@\n xxx\n-yyy\n+yyy_changed\n zzz\n",
      },
    ];

    // Dry-run passes for both
    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 2, "Both should be applicable in dry-run");

    // Now make b.ts read-only so the write fails
    fs.chmodSync(path.join(repo, "src/b.ts"), 0o444);

    const result = applyPatches(patches, { repoRoot: repo, confirmed: true, dryRunResult: dryRun });

    assert(result.status === "rolled_back", `Expected rolled_back, got ${result.status}`);
    assert(result.rollback.triggered === true, "Rollback should be triggered");
    assert(result.rollback.filesReverted > 0, "Should have reverted files");

    // a.ts should be restored to original
    const aContent = readFile(repo, "src/a.ts");
    assert(aContent === "aaa\nbbb\nccc\n", "a.ts should be reverted to original content");
  } finally {
    // Restore permissions for cleanup
    const bPath = path.join(repo, "src/b.ts");
    if (fs.existsSync(bPath)) fs.chmodSync(bPath, 0o644);
    cleanupTempRepo(repo);
  }
});

// ── Run ──────────────────────────────────────────────────────────────

runTests();
