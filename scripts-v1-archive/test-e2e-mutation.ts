#!/usr/bin/env npx ts-node
/**
 * End-to-end mutation tests against a real git repository.
 *
 * Exercises the full pipeline: intake → design → decompose → execute-patch (LLM)
 * → dry-run → apply → git commit → validate.
 *
 * Requires an LLM adapter to be configured:
 *   - ANTHROPIC_API_KEY (uses ClaudeAdapter / API)
 *   - or: claude CLI installed (uses ClaudeCodeAdapter / CLI)
 *   - TPDC_ADAPTER=mock to skip (tests will be skipped)
 *
 * Usage:
 *   npx ts-node scripts/test-e2e-mutation.ts
 *
 * Environment:
 *   TPDC_ADAPTER   - "api", "code", or "mock" (default: auto-detect)
 *   TPDC_MODEL     - model override (default: "sonnet")
 *   E2E_TIMEOUT    - per-test timeout in ms (default: 600000 / 10 min)
 *   E2E_BUDGET     - max budget per LLM call in USD (default: 5)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { runWorkflow, WorkflowResult } from "../src/runtime/workflow";
import { ClaudeAdapter } from "../src/runtime/claude-adapter";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";
import { MockLLMAdapter, LLMAdapter } from "../src/runtime/types";

// ── Configuration ────────────────────────────────────────────────────

const E2E_FIXTURE_DIR = path.resolve(__dirname, "../fixtures/e2e-repo");
const E2E_TIMEOUT = parseInt(process.env.E2E_TIMEOUT || "600000", 10);
const E2E_BUDGET = parseInt(process.env.E2E_BUDGET || "5", 10);

// ── Adapter factory ──────────────────────────────────────────────────

function createAdapter(): LLMAdapter | null {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || "sonnet";

  if (adapterEnv === "mock") {
    return null; // Signal to skip
  }

  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) {
    return new ClaudeAdapter({ model });
  }

  // Try Claude Code CLI
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    return new ClaudeCodeAdapter({ model, maxBudgetUsd: E2E_BUDGET, timeoutMs: E2E_TIMEOUT });
  } catch {
    return null;
  }
}

// ── Test harness ─────────────────────────────────────────────────────

interface E2ETestCase {
  name: string;
  run: () => Promise<void>;
}

const tests: E2ETestCase[] = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, run: fn });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Repo helpers ─────────────────────────────────────────────────────

function cloneFixtureRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tpdc-e2e-"));

  // Copy all fixture files recursively
  copyDir(E2E_FIXTURE_DIR, tmpDir);

  // Initialize git
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@tpdc.dev"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "TPDC E2E Test"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "Initial commit: demo upload service"], { cwd: tmpDir, stdio: "pipe" });

  return tmpDir;
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function gitCmd(repo: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
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

function branchExists(repo: string, pattern: string): boolean {
  const branches = gitCmd(repo, "branch", "--list");
  return branches.includes(pattern);
}

function allBranches(repo: string): string[] {
  return gitCmd(repo, "branch", "--list")
    .split("\n")
    .map((b) => b.trim().replace("* ", ""));
}

function filesInLastCommit(repo: string): string[] {
  return gitCmd(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
    .split("\n")
    .filter(Boolean);
}

// ── Test scenarios ───────────────────────────────────────────────────

test("Successful mutation: add error handling to upload endpoint", async () => {
  const repo = cloneFixtureRepo();
  const originalBranch = currentBranch(repo);
  const commitsBefore = commitCount(repo);

  try {
    const result = await runWorkflow(
      {
        title: "Add error handling to upload endpoint",
        body: "The POST /api/upload endpoint in src/upload.ts has no error handling. Add a try/catch block around the file save simulation and return a 500 error JSON response if it fails. Also import and use the validateFilename function from src/utils.ts to reject filenames with path traversal characters (return 400). The upload service is an Express.js TypeScript app.",
        source: "e2e-test",
      },
      {
        llm: llm!,
        quiet: true,
        apply: true,
        confirmApply: true,
        repoRoot: repo,
        fileHints: ["src/upload.ts", "src/utils.ts", "src/index.ts"],
      },
    );

    console.log(`       Workflow ID: ${result.workflowId}`);
    console.log(`       Mode: ${result.executionMode}`);
    console.log(`       Verdict: ${result.finalVerdict}`);
    console.log(`       Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

    // Pipeline should complete
    assert(result.executionMode === "mutation", "Should be mutation mode");

    // Check stages ran
    const stageIds = result.stages.map((s) => s.capabilityId);
    assert(stageIds.includes("intake"), "Should have intake stage");
    assert(stageIds.includes("execute-patch"), "Should have execute-patch stage");
    assert(stageIds.includes("dry-run"), "Should have dry-run stage");

    // Mutation result
    assert(result.mutation !== undefined, "Should have mutation result");
    assert(result.mutation!.enabled === true, "Mutation should be enabled");

    // Log stage statuses for debugging
    for (const s of result.stages) {
      const status = `${s.status}${s.blockReason ? ` (${s.blockReason.substring(0, 60)})` : ""}`;
      console.log(`       ${s.capabilityId.padEnd(16)} ${status}`);
    }

    // If LLM generated valid patches and they applied:
    if (result.mutation!.applied) {
      console.log(`       Branch: ${result.mutation!.branchName}`);
      console.log(`       Commit: ${result.mutation!.commitHash.substring(0, 12)}`);
      console.log(`       Files: ${result.mutation!.filesChanged.join(", ")}`);

      // Git assertions
      assert(result.mutation!.branchName.startsWith("tpdc/run-"), "Branch should have tpdc prefix");
      assert(result.mutation!.commitHash.length > 0, "Commit hash should exist");
      assert(result.mutation!.filesChanged.length > 0, "At least one file changed");

      // Verify in repo
      const branches = allBranches(repo);
      assert(branches.some((b) => b.startsWith("tpdc/run-")), "tpdc branch should exist in repo");
      assert(commitCount(repo) > commitsBefore, "Should have new commits");

      // Commit message traceability
      const msg = lastCommitMessage(repo);
      assert(msg.includes("TPDC Apply"), "Commit message should have TPDC header");
      assert(msg.includes(result.workflowId), "Commit should contain workflow ID");

      // Validate verdict should be pass or inconclusive (LLM variability)
      assert(
        result.finalVerdict === "pass" || result.finalVerdict === "inconclusive",
        `Expected pass or inconclusive, got ${result.finalVerdict}`,
      );
    } else if (result.mutation!.patchGenerated) {
      // Patches generated but not applied (LLM variability — bad diff context)
      console.log("       Note: patches generated but not applied (LLM variability)");
      if (result.mutation!.errors.length > 0) {
        console.log(`       Errors: ${result.mutation!.errors.join("; ").substring(0, 120)}`);
      }

      // Pipeline should have attempted dry-run at minimum
      const dryRunStage = result.stages.find((s) => s.capabilityId === "dry-run");
      assert(
        dryRunStage !== undefined,
        "Dry-run stage should exist even if patches failed to apply",
      );
    } else {
      // execute-patch failed or was skipped (decompose blocked, schema error, etc.)
      console.log("       Note: patches not generated (LLM variability — decompose may have blocked)");
      const execPatchStage = result.stages.find((s) => s.capabilityId === "execute-patch");
      assert(execPatchStage !== undefined, "execute-patch stage should exist");
      console.log(`       execute-patch status: ${execPatchStage!.status}`);

      // This is valid LLM behavior — decompose can block with open questions.
      // The pipeline handles it correctly by skipping downstream stages.
      const decomposeStage = result.stages.find((s) => s.capabilityId === "decompose");
      if (decomposeStage?.status === "blocked") {
        console.log("       (decompose blocked with open questions — valid pipeline behavior)");
      }
    }
  } finally {
    cleanup(repo);
  }
});

test("Dry-run rejection: request targets denied file (.env)", async () => {
  const repo = cloneFixtureRepo();

  // Add a .env file to the repo so the LLM can see it
  fs.writeFileSync(path.join(repo, ".env"), "PORT=3000\nDB_HOST=localhost\n", "utf-8");
  execFileSync("git", ["add", ".env"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "Add .env"], { cwd: repo, stdio: "pipe" });

  const originalBranch = currentBranch(repo);
  const commitsBefore = commitCount(repo);

  try {
    const result = await runWorkflow(
      "Add a new environment variable API_SECRET=sk_live_abc123 to the .env file and reference it in src/index.ts as process.env.API_SECRET. The .env file needs to be modified to include the new secret key.",
      {
        llm: llm!,
        quiet: true,
        apply: true,
        confirmApply: true,
        repoRoot: repo,
        fileHints: [".env", "src/index.ts"],
      },
    );

    console.log(`       Workflow ID: ${result.workflowId}`);
    console.log(`       Mode: ${result.executionMode}`);
    console.log(`       Verdict: ${result.finalVerdict}`);
    console.log(`       Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

    assert(result.executionMode === "mutation", "Should be mutation mode");
    assert(result.mutation !== undefined, "Should have mutation result");

    // Check what happened
    if (result.mutation!.patchGenerated) {
      // If LLM targeted .env, dry-run should catch it
      const dryRunStage = result.stages.find((s) => s.capabilityId === "dry-run");
      const applyStage = result.stages.find((s) => s.capabilityId === "apply");

      if (dryRunStage && dryRunStage.status === "failed") {
        console.log("       Dry-run correctly rejected patches targeting .env");
        assert(result.mutation!.applied === false, "Should not have applied");
        assert(result.mutation!.rollbackTriggered === false, "No rollback needed");

        // Repo unchanged
        assert(currentBranch(repo) === originalBranch, "Should be on original branch");
        assert(commitCount(repo) === commitsBefore, "No new commits");
      } else if (applyStage && applyStage.status !== "passed") {
        console.log("       Apply failed/blocked (patches may have targeted .env indirectly)");
        assert(result.mutation!.applied === false, "Should not have applied");
      } else {
        // LLM may have only targeted src/index.ts (avoiding .env)
        console.log("       Note: LLM may have avoided .env entirely — still valid");
      }
    } else {
      // LLM blocked at execute-patch stage
      console.log("       Patch generation blocked/failed");
    }

    // No matter what: .env content should be unchanged
    const envContent = fs.readFileSync(path.join(repo, ".env"), "utf-8");
    assert(!envContent.includes("API_SECRET"), ".env should not contain API_SECRET");
  } finally {
    cleanup(repo);
  }
});

test("No confirmation: --apply without --confirm-apply", async () => {
  const repo = cloneFixtureRepo();
  const originalBranch = currentBranch(repo);
  const commitsBefore = commitCount(repo);

  try {
    const result = await runWorkflow(
      "Add a simple request logging utility function called logRequest to src/utils.ts that logs the HTTP method, path, and timestamp. Then import and use it in the upload handler in src/upload.ts.",
      {
        llm: llm!,
        quiet: true,
        apply: true,
        confirmApply: false, // No confirmation
        repoRoot: repo,
        fileHints: ["src/utils.ts", "src/upload.ts"],
      },
    );

    console.log(`       Workflow ID: ${result.workflowId}`);
    console.log(`       Mode: ${result.executionMode}`);
    console.log(`       Verdict: ${result.finalVerdict}`);
    console.log(`       Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

    assert(result.executionMode === "mutation", "Should be mutation mode");
    assert(result.mutation !== undefined, "Should have mutation result");

    // Confirmation gate
    assert(result.mutation!.applyConfirmed === false, "Should NOT be confirmed");
    assert(result.mutation!.applied === false, "Should NOT have applied");

    // Check apply stage was blocked
    const applyStage = result.stages.find((s) => s.capabilityId === "apply");
    if (applyStage) {
      assert(
        applyStage.status === "blocked",
        `Apply should be blocked, got ${applyStage.status}`,
      );
      assert(
        applyStage.blockReason?.includes("confirm-apply") ?? false,
        "Block reason should mention confirm-apply",
      );
    }

    // Repo unchanged
    assert(currentBranch(repo) === originalBranch, "Should be on original branch");
    assert(commitCount(repo) === commitsBefore, "No new commits");

    // No branch created
    const branches = allBranches(repo);
    assert(!branches.some((b) => b.startsWith("tpdc/run-")), "No tpdc branch should exist");

    // Pipeline should still reach validate
    const validateStage = result.stages.find((s) => s.capabilityId === "validate");
    if (validateStage) {
      assert(
        validateStage.status === "passed" || validateStage.status === "failed",
        `Validate should have run, got ${validateStage.status}`,
      );
      console.log(`       Validate ran: ${validateStage.status}`);
    }
  } finally {
    cleanup(repo);
  }
});

// ── Main ─────────────────────────────────────────────────────────────

let llm: LLMAdapter | null = null;

async function main() {
  console.log("\n========================================");
  console.log("  TPDC Engine — E2E Mutation Tests");
  console.log("========================================\n");

  // Check LLM availability
  llm = createAdapter();
  if (!llm) {
    console.log("  No LLM adapter available. Skipping E2E tests.");
    console.log("  To run, set ANTHROPIC_API_KEY or install Claude Code CLI.\n");
    console.log("  Alternatively, set TPDC_ADAPTER=api or ensure `claude` is on PATH.\n");
    process.exit(0);
  }

  console.log(`  Adapter: ${llm.adapterInfo.adapterId} (${llm.adapterInfo.transport})`);
  console.log(`  Model: ${llm.adapterInfo.modelId}`);
  console.log(`  Timeout: ${(E2E_TIMEOUT / 1000).toFixed(0)}s per test`);
  console.log(`  Budget: $${E2E_BUDGET} per LLM call`);
  console.log(`  Fixture: ${E2E_FIXTURE_DIR}`);
  console.log(`  Tests: ${tests.length}\n`);

  const suiteStart = Date.now();

  for (const t of tests) {
    const testStart = Date.now();
    process.stdout.write(`  ${t.name}\n`);

    try {
      await Promise.race([
        t.run(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Test timed out after ${E2E_TIMEOUT}ms`)),
            E2E_TIMEOUT,
          ),
        ),
      ]);
      const dur = ((Date.now() - testStart) / 1000).toFixed(1);
      console.log(`       [OK] (${dur}s)\n`);
      passed++;
    } catch (err) {
      const dur = ((Date.now() - testStart) / 1000).toFixed(1);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`       [!!] (${dur}s)`);
      console.log(`       ${msg.split("\n")[0]}\n`);
      failed++;
    }
  }

  const totalDur = ((Date.now() - suiteStart) / 1000).toFixed(1);

  console.log("  ─────────────────────────────────────────");
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`  Total: ${totalDur}s`);
  console.log("  ─────────────────────────────────────────\n");

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
