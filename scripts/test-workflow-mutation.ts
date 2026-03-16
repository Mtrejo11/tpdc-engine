#!/usr/bin/env npx ts-node
/**
 * Integration tests for mutation-mode workflow.
 *
 * Tests the full pipeline: intake → design → decompose → execute-patch → dry-run → apply → validate
 * in isolated temporary git repos.
 *
 * These tests exercise the workflow branching logic, confirmation gates,
 * and apply/rollback behavior — they do NOT call the LLM.
 * Instead they test the orchestrator's handling of each mutation stage.
 *
 * Usage:
 *   npx ts-node scripts/test-workflow-mutation.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { defaultSafetyConfig } from "../src/patch/safetyChecks";
import { applyPatches } from "../src/patch/applyPatch";
import { gitApplyPatches, GitApplyResult, buildBranchName } from "../src/patch/gitIntegration";
import { saveArtifact } from "../src/storage/local";

// ── Test harness ─────────────────────────────────────────────────────

interface TestCase { name: string; run: () => void; }
const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) { tests.push({ name, run: fn }); }
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function runTests() {
  console.log(`\n[Workflow Mutation Tests] Running ${tests.length} tests\n`);
  for (const t of tests) {
    try { t.run(); console.log(`  [OK] ${t.name}`); passed++; }
    catch (err) {
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

function makeTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpdc-wf-mut-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@tpdc.dev"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "TPDC Test"], { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, ".gitkeep"), "");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir, stdio: "pipe" });
  return dir;
}

function cleanup(dir: string) { fs.rmSync(dir, { recursive: true, force: true }); }

function writeFile(repo: string, rel: string, content: string) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

function readFile(repo: string, rel: string): string {
  return fs.readFileSync(path.join(repo, rel), "utf-8");
}

function gitCmd(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function currentBranch(repo: string): string {
  return gitCmd(repo, "rev-parse", "--abbrev-ref", "HEAD");
}

function commitCount(repo: string): number {
  return parseInt(gitCmd(repo, "rev-list", "--count", "HEAD"), 10);
}

function lastCommitMessage(repo: string): string {
  return gitCmd(repo, "log", "-1", "--pretty=%B");
}

function safetyFor(repo: string) {
  return { ...defaultSafetyConfig(repo), denyPatterns: [] };
}

// ── Tests ────────────────────────────────────────────────────────────

test("Blocked plan skips all mutation stages", () => {
  // Simulates: decompose returns blocked → execute-patch, dry-run, apply all skipped
  const repo = makeTempGitRepo();
  try {
    const originalBranch = currentBranch(repo);
    const commitsBefore = commitCount(repo);

    // Blocked plan — no patches should be generated or applied
    const patches: PatchInput[] = [];
    const dryRun = dryRunValidate(patches, safetyFor(repo));

    assert(dryRun.applicable === 0, "No patches = no applicable");

    // Simulate: gitApplyPatches with no applicable patches
    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "wf_blocked_test",
    });

    assert(result.applyResult.status === "rejected", `Expected rejected, got ${result.applyResult.status}`);
    assert(result.git.commitCreated === false, "No commit should be created");
    assert(currentBranch(repo) === originalBranch, "Should stay on original branch");
    assert(commitCount(repo) === commitsBefore, "No new commits");
  } finally {
    cleanup(repo);
  }
});

test("Apply without confirmation is blocked", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/a.ts", "line1\nline2\nline3\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add file");

    const patches: PatchInput[] = [{
      filePath: "src/a.ts",
      operation: "modify",
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_changed\n line3\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, "Patch should be applicable");

    // No confirmation
    const result = applyPatches(patches, {
      repoRoot: repo,
      confirmed: false,
      dryRunResult: dryRun,
    });

    assert(result.status === "rejected", `Expected rejected, got ${result.status}`);
    assert(result.errors[0].includes("confirmation"), "Error should mention confirmation");

    const content = readFile(repo, "src/a.ts");
    assert(content === "line1\nline2\nline3\n", "File should be unchanged");
  } finally {
    cleanup(repo);
  }
});

test("Full apply + commit with confirmation", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/main.ts", "const x = 1;\nconst y = 2;\nconst z = 3;\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add main");

    const originalBranch = currentBranch(repo);
    const commitsBefore = commitCount(repo);

    const patches: PatchInput[] = [{
      filePath: "src/main.ts",
      operation: "modify",
      diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,3 @@\n const x = 1;\n-const y = 2;\n+const y = 42;\n const z = 3;\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, "Patch should be applicable");
    assert(dryRun.safe, "Dry-run should be safe");

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "wf_1773099000000_testrun1",
      planTitle: "ADR: Update constant",
      patchArtifactRef: "wf_test/execute-patch.json",
      changeSummary: "Changed y from 2 to 42",
    });

    // Apply succeeded
    assert(result.applyResult.status === "applied", `Expected applied, got ${result.applyResult.status}`);
    assert(result.applyResult.filesChanged === 1, "1 file changed");

    // Git integration
    assert(result.git.branchCreated === true, "Branch should be created");
    assert(result.git.branchName.startsWith("tpdc/run-"), "Branch name correct");
    assert(result.git.commitCreated === true, "Commit should be created");
    assert(result.git.commitHash.length > 0, "Hash should be present");
    assert(result.git.filesStaged.length === 1, "1 file staged");

    // Verify state
    assert(currentBranch(repo) !== originalBranch, "On new branch");
    assert(commitCount(repo) === commitsBefore + 1, "One new commit");

    const msg = lastCommitMessage(repo);
    assert(msg.includes("TPDC Apply"), "Commit message has header");
    assert(msg.includes("wf_1773099000000_testrun1"), "Commit has run ID");
    assert(msg.includes("src/main.ts"), "Commit lists file");

    // File content
    const content = readFile(repo, "src/main.ts");
    assert(content.includes("const y = 42;"), "File should be modified");
  } finally {
    cleanup(repo);
  }
});

test("Dry-run rejection prevents apply", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/target.ts", "real content\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Initial");

    // Patch with wrong context — will fail dry-run
    const patches: PatchInput[] = [{
      filePath: "src/target.ts",
      operation: "modify",
      diff: "--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-wrong content\n+fixed content\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 0, "Patch should not be applicable (context mismatch)");
    assert(dryRun.conflicts === 1, "Should have 1 conflict");

    // Try to apply — should be rejected because no applicable patches
    const result = applyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
    });

    assert(result.status === "rejected", `Expected rejected, got ${result.status}`);
    assert(result.errors[0].includes("no applicable"), "Error should mention no applicable patches");

    // File unchanged
    assert(readFile(repo, "src/target.ts") === "real content\n", "File should be unchanged");
  } finally {
    cleanup(repo);
  }
});

test("Rollback on failure leaves no commit", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/a.ts", "aaa\nbbb\nccc\n");
    writeFile(repo, "src/b.ts", "xxx\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Initial");

    const originalBranch = currentBranch(repo);
    const commitsBefore = commitCount(repo);

    // Make b.ts read-only to force write failure
    fs.chmodSync(path.join(repo, "src/b.ts"), 0o444);

    const patches: PatchInput[] = [
      {
        filePath: "src/a.ts",
        operation: "modify",
        diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n aaa\n-bbb\n+bbb_changed\n ccc\n",
      },
      {
        filePath: "src/b.ts",
        operation: "modify",
        diff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-xxx\n+yyy\n",
      },
    ];

    const dryRun = dryRunValidate(patches, safetyFor(repo));

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "wf_rollback_test",
    });

    assert(result.applyResult.status === "rolled_back", `Expected rolled_back, got ${result.applyResult.status}`);
    assert(result.applyResult.rollback.triggered === true, "Rollback should trigger");
    assert(result.git.commitCreated === false, "No commit");
    assert(result.git.branchCreated === false, "Branch should be cleaned up");
    assert(currentBranch(repo) === originalBranch, "Back on original branch");
    assert(commitCount(repo) === commitsBefore, "No new commits");

    // a.ts reverted
    assert(readFile(repo, "src/a.ts") === "aaa\nbbb\nccc\n", "a.ts should be reverted");
  } finally {
    const bPath = path.join(repo, "src/b.ts");
    if (fs.existsSync(bPath)) fs.chmodSync(bPath, 0o644);
    cleanup(repo);
  }
});

test("Create + modify in single workflow commit", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/existing.ts", "old code\nmore code\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Initial");

    const patches: PatchInput[] = [
      {
        filePath: "src/existing.ts",
        operation: "modify",
        diff: "--- a/src/existing.ts\n+++ b/src/existing.ts\n@@ -1,2 +1,2 @@\n-old code\n+new code\n more code\n",
      },
      {
        filePath: "src/brand-new.ts",
        operation: "create",
        diff: "--- /dev/null\n+++ b/src/brand-new.ts\n@@ -0,0 +1,2 @@\n+export const fresh = true;\n+export default fresh;\n",
      },
    ];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 2, "Both should be applicable");

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "wf_1773099000000_mixed",
      changeSummary: "Modified existing, created brand-new",
    });

    assert(result.applyResult.status === "applied", `Expected applied, got ${result.applyResult.status}`);
    assert(result.git.commitCreated === true, "Commit created");
    assert(result.git.filesStaged.length === 2, "2 files staged");

    assert(readFile(repo, "src/existing.ts").includes("new code"), "existing.ts modified");
    assert(readFile(repo, "src/brand-new.ts").includes("fresh"), "brand-new.ts created");

    const msg = lastCommitMessage(repo);
    assert(msg.includes("src/existing.ts"), "Commit lists existing.ts");
    assert(msg.includes("src/brand-new.ts"), "Commit lists brand-new.ts");
  } finally {
    cleanup(repo);
  }
});

// ── Run ──────────────────────────────────────────────────────────────

runTests();
