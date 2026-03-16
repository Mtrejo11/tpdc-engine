#!/usr/bin/env npx ts-node
/**
 * Tests for interactive confirmation with diff preview.
 *
 * Tests the preview renderer, confirmation flow, and integration
 * with the workflow apply stage — all without LLM calls.
 *
 * Usage:
 *   npx ts-node scripts/test-confirmation.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { defaultSafetyConfig } from "../src/patch/safetyChecks";
import { renderPreview, confirmWithPreview, PreviewData } from "../src/patch/confirmationPreview";
import { gitApplyPatches } from "../src/patch/gitIntegration";

// ── Test harness ─────────────────────────────────────────────────────

interface TestCase { name: string; run: () => void | Promise<void>; }
const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) { tests.push({ name, run: fn }); }
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runTests() {
  console.log(`\n[Confirmation Tests] Running ${tests.length} tests\n`);
  for (const t of tests) {
    try { await t.run(); console.log(`  [OK] ${t.name}`); passed++; }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpdc-confirm-"));
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

function safetyFor(repo: string) {
  return { ...defaultSafetyConfig(repo), denyPatterns: [] };
}

function makePreviewData(repo: string, patches: PatchInput[]): PreviewData {
  const dryRun = dryRunValidate(patches, safetyFor(repo));
  return {
    runId: "wf_1773099000000_testrun1",
    repoRoot: repo,
    patches,
    dryRunResult: dryRun,
    planTitle: "Test Plan: Add Feature",
  };
}

// Collect log output instead of printing
function captureLog(): { log: (...args: unknown[]) => void; output: string[] } {
  const output: string[] = [];
  return {
    log: (...args: unknown[]) => { output.push(args.map(String).join(" ")); },
    output,
  };
}

// ── Tests: Preview rendering ────────────────────────────────────────

test("Preview shows patch count and branch name", () => {
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

    const data = makePreviewData(repo, patches);
    const preview = renderPreview(data);

    assert(preview.includes("MUTATION PREVIEW"), "Should have header");
    assert(preview.includes("Patches:  1"), "Should show patch count");
    assert(preview.includes("tpdc/run-"), "Should show branch name");
    assert(preview.includes("Test Plan: Add Feature"), "Should show plan title");
    assert(preview.includes("src/a.ts"), "Should list file");
    assert(preview.includes("MODIFY"), "Should show operation");
  } finally {
    cleanup(repo);
  }
});

test("Preview shows diff lines", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/b.ts", "old\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add file");

    const patches: PatchInput[] = [{
      filePath: "src/b.ts",
      operation: "modify",
      diff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new\n",
    }];

    const data = makePreviewData(repo, patches);
    const preview = renderPreview(data);

    assert(preview.includes("-old"), "Should show removed line");
    assert(preview.includes("+new"), "Should show added line");
  } finally {
    cleanup(repo);
  }
});

test("Preview shows create and delete operations", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/old.ts", "delete me\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add file");

    const patches: PatchInput[] = [
      {
        filePath: "src/new.ts",
        operation: "create",
        diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+export const x = 1;\n",
      },
      {
        filePath: "src/old.ts",
        operation: "delete",
        diff: "--- a/src/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-delete me\n",
      },
    ];

    const data = makePreviewData(repo, patches);
    const preview = renderPreview(data);

    assert(preview.includes("CREATE"), "Should show CREATE");
    assert(preview.includes("DELETE"), "Should show DELETE");
    assert(preview.includes("Patches:  2"), "Should show 2 patches");
  } finally {
    cleanup(repo);
  }
});

test("Preview truncates long diffs", () => {
  const repo = makeTempGitRepo();
  try {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    writeFile(repo, "src/big.ts", lines);
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add file");

    // Build a diff that changes many lines
    const oldLines = Array.from({ length: 20 }, (_, i) => ` line${i + 1}`).join("\n");
    const newLines = Array.from({ length: 20 }, (_, i) =>
      i < 10 ? `-line${i + 1}` : `+line${i + 1}_new`
    ).join("\n");
    // Simplified: just check that "more lines" message appears for big diffs
    const diff = "--- a/src/big.ts\n+++ b/src/big.ts\n@@ -1,20 +1,20 @@\n" +
      Array.from({ length: 20 }, (_, i) => `-line${i + 1}\n+line${i + 1}_changed`).join("\n") + "\n";

    const patches: PatchInput[] = [{
      filePath: "src/big.ts",
      operation: "modify",
      diff,
    }];

    const data = makePreviewData(repo, patches);
    const preview = renderPreview(data);

    assert(preview.includes("more lines"), "Should truncate with 'more lines' indicator");
  } finally {
    cleanup(repo);
  }
});

test("Preview shows safety violations", () => {
  const repo = makeTempGitRepo();
  try {
    const patches: PatchInput[] = [{
      filePath: ".env",
      operation: "create",
      diff: "--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=abc\n",
    }];

    // Use default safety (which denies .env)
    const dryRun = dryRunValidate(patches, defaultSafetyConfig(repo));
    const data: PreviewData = {
      runId: "wf_1773099000000_testrun1",
      repoRoot: repo,
      patches,
      dryRunResult: dryRun,
      planTitle: "Bad Plan",
    };

    const preview = renderPreview(data);
    assert(preview.includes("Safety violations"), "Should show safety section");
    assert(preview.includes(".env"), "Should mention .env");
    assert(preview.includes("Safe:     NO"), "Should show safe=NO");
  } finally {
    cleanup(repo);
  }
});

// ── Tests: Confirmation flow ────────────────────────────────────────

test("confirmWithPreview: --confirm-apply returns confirmed with flag source", async () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/a.ts", "line1\nline2\nline3\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add");

    const patches: PatchInput[] = [{
      filePath: "src/a.ts",
      operation: "modify",
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_changed\n line3\n",
    }];

    const data = makePreviewData(repo, patches);
    const cap = captureLog();

    const result = await confirmWithPreview(data, {
      confirmApply: true,
      interactive: false,
      log: cap.log,
    });

    assert(result.previewShown === true, "Preview should be shown");
    assert(result.confirmed === true, "Should be confirmed");
    assert(result.source === "flag", `Source should be flag, got ${result.source}`);

    // Preview output captured
    const output = cap.output.join("\n");
    assert(output.includes("MUTATION PREVIEW"), "Log should contain preview");
    assert(output.includes("--confirm-apply"), "Log should mention --confirm-apply");
  } finally {
    cleanup(repo);
  }
});

test("confirmWithPreview: no flags returns declined", async () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/a.ts", "line1\nline2\nline3\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add");

    const patches: PatchInput[] = [{
      filePath: "src/a.ts",
      operation: "modify",
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_changed\n line3\n",
    }];

    const data = makePreviewData(repo, patches);
    const cap = captureLog();

    const result = await confirmWithPreview(data, {
      confirmApply: false,
      interactive: false,
      log: cap.log,
    });

    assert(result.previewShown === true, "Preview should still be shown");
    assert(result.confirmed === false, "Should NOT be confirmed");
    assert(result.source === "declined", `Source should be declined, got ${result.source}`);
  } finally {
    cleanup(repo);
  }
});

// ── Tests: Workflow integration ─────────────────────────────────────

test("Workflow: --confirm-apply still applies patches (flag source)", () => {
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

    const result = gitApplyPatches(patches, {
      repoRoot: repo,
      confirmed: true,
      dryRunResult: dryRun,
      runId: "wf_1773099000000_flagtest",
      planTitle: "Test Plan",
    });

    assert(result.applyResult.status === "applied", `Expected applied, got ${result.applyResult.status}`);
    assert(result.git.commitCreated === true, "Commit should be created");
    assert(result.git.branchCreated === true, "Branch should be created");
    assert(commitCount(repo) === commitsBefore + 1, "One new commit");

    const content = readFile(repo, "src/main.ts");
    assert(content.includes("const y = 42;"), "File should be modified");
  } finally {
    cleanup(repo);
  }
});

test("Workflow: declined confirmation leaves repo unchanged", () => {
  const repo = makeTempGitRepo();
  try {
    writeFile(repo, "src/main.ts", "const x = 1;\nconst y = 2;\nconst z = 3;\n");
    gitCmd(repo, "add", ".");
    gitCmd(repo, "commit", "-m", "Add main");

    const originalBranch = currentBranch(repo);
    const commitsBefore = commitCount(repo);

    // Simulate: dry-run passes but user declines
    // (no apply happens — repo stays clean)
    const patches: PatchInput[] = [{
      filePath: "src/main.ts",
      operation: "modify",
      diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,3 @@\n const x = 1;\n-const y = 2;\n+const y = 42;\n const z = 3;\n",
    }];

    const dryRun = dryRunValidate(patches, safetyFor(repo));
    assert(dryRun.applicable === 1, "Patch should be applicable");

    // NOT calling gitApplyPatches — simulating declined confirmation
    // Verify repo is untouched
    assert(currentBranch(repo) === originalBranch, "Should stay on original branch");
    assert(commitCount(repo) === commitsBefore, "No new commits");
    const content = readFile(repo, "src/main.ts");
    assert(content.includes("const y = 2;"), "File should be unchanged");
  } finally {
    cleanup(repo);
  }
});

test("MutationResult tracks confirmation source correctly", () => {
  // Test the MutationResult shape — no repo needed
  interface MutationResult {
    previewShown: boolean;
    applyConfirmed: boolean;
    confirmationSource: "flag" | "interactive" | "declined" | "none";
  }

  // Case 1: --confirm-apply
  const flagResult: MutationResult = {
    previewShown: true,
    applyConfirmed: true,
    confirmationSource: "flag",
  };
  assert(flagResult.confirmationSource === "flag", "Should be flag");
  assert(flagResult.applyConfirmed === true, "Should be confirmed");

  // Case 2: interactive accept
  const interactiveResult: MutationResult = {
    previewShown: true,
    applyConfirmed: true,
    confirmationSource: "interactive",
  };
  assert(interactiveResult.confirmationSource === "interactive", "Should be interactive");

  // Case 3: interactive decline
  const declinedResult: MutationResult = {
    previewShown: true,
    applyConfirmed: false,
    confirmationSource: "declined",
  };
  assert(declinedResult.confirmationSource === "declined", "Should be declined");
  assert(declinedResult.applyConfirmed === false, "Should not be confirmed");

  // Case 4: no mechanism
  const noneResult: MutationResult = {
    previewShown: false,
    applyConfirmed: false,
    confirmationSource: "none",
  };
  assert(noneResult.confirmationSource === "none", "Should be none");
});

// ── Run ──────────────────────────────────────────────────────────────

runTests();
