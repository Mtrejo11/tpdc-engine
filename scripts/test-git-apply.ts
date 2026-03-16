#!/usr/bin/env npx ts-node
/**
 * Test runner for Git integration with apply mode.
 *
 * All tests run in isolated temporary git repositories.
 * No real repos are modified.
 *
 * Usage:
 *   npx ts-node scripts/test-git-apply.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { defaultSafetyConfig, SafetyConfig } from "../src/patch/safetyChecks";
import { DryRunResult } from "../src/patch/dryRun";
import {
  gitApplyPatches,
  GitApplyOptions,
  buildBranchName,
  buildCommitMessage,
} from "../src/patch/gitIntegration";

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
  console.log(`\n[Git Apply Tests] Running ${tests.length} tests\n`);

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

function makeTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpdc-git-test-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@tpdc.dev"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "TPDC Test"], { cwd: dir, stdio: "pipe" });
  // Create initial commit so we have a HEAD
  fs.writeFileSync(path.join(dir, ".gitkeep"), "");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: dir, stdio: "pipe" });
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

function gitCmd(repoRoot: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function currentBranch(repoRoot: string): string {
  return gitCmd(repoRoot, "rev-parse", "--abbrev-ref", "HEAD");
}

function commitCount(repoRoot: string): number {
  return parseInt(gitCmd(repoRoot, "rev-list", "--count", "HEAD"), 10);
}

function lastCommitMessage(repoRoot: string): string {
  return gitCmd(repoRoot, "log", "-1", "--pretty=%B");
}

function safetyFor(repoRoot: string): SafetyConfig {
  return { ...defaultSafetyConfig(repoRoot), denyPatterns: [] };
}

// ── Tests ────────────────────────────────────────────────────────────

test("buildBranchName formats correctly", () => {
  const name = buildBranchName("apply_1773098000000_abcdef12");
  assert(name.startsWith("tpdc/run-"), `Expected tpdc/run- prefix, got: ${name}`);
  assert(name.includes("abcdef12"), `Expected hash in branch name, got: ${name}`);
});

test("Branch creation on successful apply", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/foo.ts", "line1\nline2\nline3\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add foo");

    const originalBranch = currentBranch(repo);

    const patches: PatchInput[] = [{
      filePath: "src/foo.ts",
      operation: "modify",
      diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_modified\n line3\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, "Patch should be applicable");

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "apply_1773098000000_abcdef12",
      planTitle: "Test Plan",
      patchArtifactRef: "test-artifact",
      changeSummary: "Modified foo.ts for testing",
    });

    assert(result.git.branchCreated === true, "Branch should be created");
    assert(result.git.branchName.startsWith("tpdc/run-"), "Branch name should have prefix");
    assert(currentBranch(repo) === result.git.branchName, "Should be on new branch");
    assert(currentBranch(repo) !== originalBranch, "Should not be on original branch");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Successful apply creates commit with traceability", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/bar.ts", "aaa\nbbb\nccc\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add bar");

    const commitsBefore = commitCount(repo);

    const patches: PatchInput[] = [{
      filePath: "src/bar.ts",
      operation: "modify",
      diff: "--- a/src/bar.ts\n+++ b/src/bar.ts\n@@ -1,3 +1,3 @@\n aaa\n-bbb\n+bbb_changed\n ccc\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "apply_1773098000000_ff00ff00",
      planTitle: "ADR: Test Feature",
      patchArtifactRef: "run_123/execute-patch.json",
      changeSummary: "Changed bbb to bbb_changed in bar.ts",
    });

    assert(result.git.commitCreated === true, "Commit should be created");
    assert(result.git.commitHash.length > 0, "Commit hash should be present");
    assert(commitCount(repo) === commitsBefore + 1, "Should have one new commit");

    const msg = lastCommitMessage(repo);
    assert(msg.includes("TPDC Apply"), "Commit should start with TPDC Apply");
    assert(msg.includes("apply_1773098000000_ff00ff00"), "Commit should contain run ID");
    assert(msg.includes("run_123/execute-patch.json"), "Commit should contain artifact ref");
    assert(msg.includes("ADR: Test Feature"), "Commit should contain plan title");
    assert(msg.includes("src/bar.ts"), "Commit should list changed files");
    assert(msg.includes("Patches Applied: 1"), "Commit should contain patch count");

    // File should be modified
    const content = readFile(repo, "src/bar.ts");
    assert(content.includes("bbb_changed"), "File should be modified");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Stages only applied files, not entire repo", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/target.ts", "old\n");
    writeFile(repo, "src/unrelated.ts", "should not be staged\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Initial files");

    // Modify unrelated file without staging
    writeFile(repo, "src/unrelated.ts", "modified but should not be staged\n");

    const patches: PatchInput[] = [{
      filePath: "src/target.ts",
      operation: "modify",
      diff: "--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-old\n+new\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "apply_1773098000000_stage01",
    });

    assert(result.git.commitCreated === true, "Commit should be created");
    assert(result.git.filesStaged.length === 1, `Should stage 1 file, got ${result.git.filesStaged.length}`);
    assert(result.git.filesStaged[0] === "src/target.ts", "Should only stage target.ts");

    // unrelated.ts should still show as modified in working tree
    const status = gitCmd(repo, "status", "--porcelain");
    assert(status.includes("src/unrelated.ts"), "Unrelated file should still be unstaged");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Rollback does not create commit", () => {
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
      runId: "apply_1773098000000_rollback",
    });

    assert(result.applyResult.status === "rolled_back", `Expected rolled_back, got ${result.applyResult.status}`);
    assert(result.git.commitCreated === false, "No commit should be created");
    assert(result.git.branchCreated === false, "Branch should be cleaned up");
    assert(currentBranch(repo) === originalBranch, "Should be back on original branch");
    assert(commitCount(repo) === commitsBefore, "No new commits");

    // a.ts should be reverted
    const aContent = readFile(repo, "src/a.ts");
    assert(aContent === "aaa\nbbb\nccc\n", "a.ts should be reverted");
  } finally {
    // Restore permissions
    const bPath = path.join(repo, "src/b.ts");
    if (fs.existsSync(bPath)) fs.chmodSync(bPath, 0o644);
    cleanupTempRepo(repo);
  }
});

test("Multiple file modifications in single commit", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/one.ts", "alpha\nbeta\ngamma\n");
    writeFile(repo, "src/two.ts", "red\ngreen\nblue\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Initial");

    const patches: PatchInput[] = [
      {
        filePath: "src/one.ts",
        operation: "modify",
        diff: "--- a/src/one.ts\n+++ b/src/one.ts\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+beta_v2\n gamma\n",
      },
      {
        filePath: "src/two.ts",
        operation: "modify",
        diff: "--- a/src/two.ts\n+++ b/src/two.ts\n@@ -1,3 +1,3 @@\n red\n-green\n+green_v2\n blue\n",
      },
    ];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 2, "Both should be applicable");

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "apply_1773098000000_multi",
      changeSummary: "Updated both files",
    });

    assert(result.applyResult.status === "applied", `Expected applied, got ${result.applyResult.status}`);
    assert(result.git.commitCreated === true, "Commit should be created");
    assert(result.git.filesStaged.length === 2, "Should stage 2 files");

    const msg = lastCommitMessage(repo);
    assert(msg.includes("src/one.ts"), "Commit should list one.ts");
    assert(msg.includes("src/two.ts"), "Commit should list two.ts");
    assert(msg.includes("Patches Applied: 2"), "Should show 2 patches");

    assert(readFile(repo, "src/one.ts").includes("beta_v2"), "one.ts should be modified");
    assert(readFile(repo, "src/two.ts").includes("green_v2"), "two.ts should be modified");
  } finally {
    cleanupTempRepo(repo);
  }
});

test("Create and delete files with git tracking", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/old.ts", "to be deleted\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Initial");

    const patches: PatchInput[] = [
      {
        filePath: "src/new.ts",
        operation: "create",
        diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+export const x = 1;\n+export const y = 2;\n",
      },
      {
        filePath: "src/old.ts",
        operation: "delete",
        diff: "--- a/src/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-to be deleted\n",
      },
    ];

    const dryRun = dryRunValidate(patches, safetyFor(repo));

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "apply_1773098000000_creatdel",
    });

    assert(result.applyResult.status === "applied", `Expected applied, got ${result.applyResult.status}`);
    assert(result.git.commitCreated === true, "Commit should be created");
    assert(fileExists(repo, "src/new.ts"), "new.ts should exist");
    assert(!fileExists(repo, "src/old.ts"), "old.ts should be deleted");

    const msg = lastCommitMessage(repo);
    assert(msg.includes("src/new.ts"), "Commit should list created file");
    assert(msg.includes("src/old.ts"), "Commit should list deleted file");
  } finally {
    cleanupTempRepo(repo);
  }
});

// ── Run ──────────────────────────────────────────────────────────────

runTests();
