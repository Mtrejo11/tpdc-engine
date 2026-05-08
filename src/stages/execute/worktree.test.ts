/**
 * Worktree integration test — uses real git in a temporary directory.
 *
 * Validates that captureDiff and listChangedFiles correctly capture
 * BOTH modified-tracked files AND new untracked files.
 *
 * Regression guard for the bug observed in the stage 3+4 smoke (2026-05-08):
 * `git diff <sha>` was missing untracked files entirely, so the workflow's
 * filesChanged count and diff string under-reported what the agent did.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureDiff, createWorktree, listChangedFiles, removeWorktree } from "./worktree.js";

const execFileAsync = promisify(execFile);

async function gitInit(repoPath: string): Promise<void> {
  await execFileAsync("git", ["init", "-q"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.email", "test@tpdc.local"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.name", "TPDC Test"], { cwd: repoPath });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: repoPath });
}

describe("worktree (integration with real git)", () => {
  let tempRoot: string;
  let repoPath: string;
  let runId: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpdc-worktree-test-"));
    repoPath = path.join(tempRoot, "repo");
    await fs.mkdir(repoPath, { recursive: true });
    await gitInit(repoPath);

    // Seed with one tracked file + a commit.
    await fs.writeFile(path.join(repoPath, "src.txt"), "original content\n");
    await execFileAsync("git", ["add", "."], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: repoPath });

    runId = `test-${Date.now().toString(36)}`;
  });

  afterEach(async () => {
    // Best-effort cleanup
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("captureDiff and listChangedFiles handle a no-op worktree", async () => {
    const handle = await createWorktree({ repoRoot: repoPath, runId });

    const diff = await captureDiff(handle);
    const files = await listChangedFiles(handle);

    expect(diff).toBe("");
    expect(files).toEqual([]);

    await removeWorktree(repoPath, handle, { deleteBranch: true });
  });

  it("captures modifications to tracked files", async () => {
    const handle = await createWorktree({ repoRoot: repoPath, runId });

    // Modify a tracked file
    await fs.writeFile(path.join(handle.path, "src.txt"), "modified content\n");

    const diff = await captureDiff(handle);
    const files = await listChangedFiles(handle);

    expect(files).toEqual(["src.txt"]);
    expect(diff).toContain("-original content");
    expect(diff).toContain("+modified content");

    await removeWorktree(repoPath, handle, { deleteBranch: true });
  });

  it("captures new untracked files (regression: stage 3+4 smoke bug)", async () => {
    const handle = await createWorktree({ repoRoot: repoPath, runId });

    // Create a new file (untracked)
    await fs.writeFile(path.join(handle.path, "new-file.txt"), "brand new content\n");

    const diff = await captureDiff(handle);
    const files = await listChangedFiles(handle);

    // The bug was: `git diff <sha>` missed untracked files entirely.
    // After fix: `git add -A` + `git diff --cached <sha>` includes them.
    expect(files).toEqual(["new-file.txt"]);
    expect(diff).toContain("+brand new content");
    expect(diff).toContain("new file mode");

    await removeWorktree(repoPath, handle, { deleteBranch: true });
  });

  it("captures BOTH a modification AND a new file in the same worktree", async () => {
    const handle = await createWorktree({ repoRoot: repoPath, runId });

    await fs.writeFile(path.join(handle.path, "src.txt"), "modified content\n");
    await fs.writeFile(path.join(handle.path, "new-file.txt"), "brand new\n");

    const diff = await captureDiff(handle);
    const files = await listChangedFiles(handle);

    expect(new Set(files)).toEqual(new Set(["src.txt", "new-file.txt"]));
    expect(diff).toContain("modified content");
    expect(diff).toContain("brand new");
  });

  it("captures files in nested directories", async () => {
    const handle = await createWorktree({ repoRoot: repoPath, runId });

    await fs.mkdir(path.join(handle.path, "deep", "nested"), { recursive: true });
    await fs.writeFile(path.join(handle.path, "deep", "nested", "file.ts"), "x\n");

    const files = await listChangedFiles(handle);
    expect(files).toEqual(["deep/nested/file.ts"]);

    await removeWorktree(repoPath, handle, { deleteBranch: true });
  });

  it("captureDiff and listChangedFiles are idempotent (safe to call twice)", async () => {
    const handle = await createWorktree({ repoRoot: repoPath, runId });

    await fs.writeFile(path.join(handle.path, "new.txt"), "x\n");

    const files1 = await listChangedFiles(handle);
    const files2 = await listChangedFiles(handle);
    const diff1 = await captureDiff(handle);
    const diff2 = await captureDiff(handle);

    expect(files1).toEqual(files2);
    expect(diff1).toBe(diff2);
  });
});
