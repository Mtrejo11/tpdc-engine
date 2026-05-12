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
import {
  captureDiff,
  commitChanges,
  createWorktree,
  ensureGitignored,
  listChangedFiles,
  removeWorktree,
  restoreWorktree,
} from "./worktree.js";

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

  describe("commitChanges (regression: stage 5 push needed commits)", () => {
    it("creates a commit on top of base when there are staged changes", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      await fs.writeFile(path.join(handle.path, "src.txt"), "modified\n");
      await fs.writeFile(path.join(handle.path, "new.txt"), "brand new\n");

      const result = await commitChanges(handle, "test: add new file and modify");

      expect(result.committed).toBe(true);
      expect(result.sha).toBeDefined();
      expect(result.sha).not.toBe(handle.baseSha);

      // Verify the commit lives in the branch
      const { stdout } = await execFileAsync(
        "git",
        ["log", "--oneline", "-n", "5"],
        { cwd: handle.path },
      );
      expect(stdout).toContain("test: add new file and modify");

      // Branch HEAD now points to the new SHA
      const { stdout: headSha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: handle.path,
      });
      expect(headSha.trim()).toBe(result.sha);
    });

    it("returns committed=false when nothing is staged (no-op)", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      const result = await commitChanges(handle, "would be empty");

      expect(result.committed).toBe(false);
      expect(result.sha).toBeUndefined();
    });

    it("returns committed=false when the agent already committed everything", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      // Simulate the agent committing during execute
      await fs.writeFile(path.join(handle.path, "agent.txt"), "agent's work\n");
      await execFileAsync("git", ["add", "."], { cwd: handle.path });
      await execFileAsync("git", ["commit", "-m", "agent's commit"], {
        cwd: handle.path,
      });

      // Now we try to commit on top — there's nothing left
      const result = await commitChanges(handle, "workflow's commit");

      expect(result.committed).toBe(false);
    });

    it("creates a commit even if the agent already committed but new untracked files were added after", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      // Agent commits some work
      await fs.writeFile(path.join(handle.path, "first.txt"), "1\n");
      await execFileAsync("git", ["add", "."], { cwd: handle.path });
      await execFileAsync("git", ["commit", "-m", "agent commit"], { cwd: handle.path });

      // Then more untracked files appear (e.g., generated by a final step)
      await fs.writeFile(path.join(handle.path, "second.txt"), "2\n");

      const result = await commitChanges(handle, "workflow follow-up");

      expect(result.committed).toBe(true);
      expect(result.sha).toBeDefined();
    });

    it("after commitChanges, listChangedFiles still returns all changes vs base", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      await fs.writeFile(path.join(handle.path, "a.txt"), "x\n");
      await fs.writeFile(path.join(handle.path, "b.txt"), "y\n");

      await commitChanges(handle, "test commit");

      const files = await listChangedFiles(handle);
      expect(new Set(files)).toEqual(new Set(["a.txt", "b.txt"]));
    });
  });

  describe("restoreWorktree (regression: stage 8-remote CI fix needs worktree back)", () => {
    it("returns the handle unchanged when the path still exists", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      const result = await restoreWorktree(repoPath, handle);

      expect(result).toEqual(handle);
      // Confirm the worktree is usable
      const files = await listChangedFiles(result);
      expect(files).toEqual([]);
    });

    it("re-creates the worktree at the original path when it was removed (the smoke bug)", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      await fs.writeFile(path.join(handle.path, "agent-work.txt"), "agent's work\n");
      const commit = await commitChanges(handle, "agent's commit");
      expect(commit.committed).toBe(true);

      // Simulate push.ts cleanup: remove the worktree dir, keep the branch.
      await removeWorktree(repoPath, handle, { deleteBranch: false });
      await expect(fs.access(handle.path)).rejects.toThrow();

      // Now the CI loop tries to reuse the handle — restoreWorktree should fix it.
      const restored = await restoreWorktree(repoPath, handle);

      expect(restored.path).toBe(handle.path);
      expect(restored.branch).toBe(handle.branch);

      // Worktree is back and the agent's prior commit is reachable
      await fs.access(restored.path);
      const { stdout: log } = await execFileAsync(
        "git",
        ["log", "--oneline", "-n", "5"],
        { cwd: restored.path },
      );
      expect(log).toContain("agent's commit");

      // Worktree is fully usable again — can stage and diff
      await fs.writeFile(path.join(restored.path, "fix.txt"), "fix\n");
      const files = await listChangedFiles(restored);
      expect(files).toContain("fix.txt");
    });

    it("throws a clear error when the branch no longer exists locally", async () => {
      const handle = await createWorktree({ repoRoot: repoPath, runId });

      // Remove the worktree AND delete the branch (simulates a more aggressive
      // cleanup than push does today, but we want a clear failure mode).
      await removeWorktree(repoPath, handle, { deleteBranch: true });

      await expect(restoreWorktree(repoPath, handle)).rejects.toThrow();
    });
  });

  // ── ensureGitignored (alpha.6) ─────────────────────────────────────

  describe("ensureGitignored — silent housekeeping for .tpdc/", () => {
    it("creates .gitignore with the entry when no .gitignore exists", async () => {
      // Fresh dir under tempRoot (NOT the seeded repoPath which has commits).
      const fresh = path.join(tempRoot, "fresh-repo");
      await fs.mkdir(fresh, { recursive: true });

      await ensureGitignored(fresh, ".tpdc/");

      const content = await fs.readFile(path.join(fresh, ".gitignore"), "utf-8");
      expect(content).toBe(".tpdc/\n");
    });

    it("appends to existing .gitignore preserving prior content", async () => {
      await fs.writeFile(path.join(repoPath, ".gitignore"), "node_modules/\ndist/\n");
      await ensureGitignored(repoPath, ".tpdc/");

      const content = await fs.readFile(path.join(repoPath, ".gitignore"), "utf-8");
      expect(content).toBe("node_modules/\ndist/\n.tpdc/\n");
    });

    it("adds a leading newline when existing file doesn't end in \\n", async () => {
      await fs.writeFile(path.join(repoPath, ".gitignore"), "node_modules/");
      await ensureGitignored(repoPath, ".tpdc/");

      const content = await fs.readFile(path.join(repoPath, ".gitignore"), "utf-8");
      expect(content).toBe("node_modules/\n.tpdc/\n");
    });

    it("is idempotent when entry already present as `.tpdc/`", async () => {
      await fs.writeFile(path.join(repoPath, ".gitignore"), ".tpdc/\n");
      await ensureGitignored(repoPath, ".tpdc/");

      const content = await fs.readFile(path.join(repoPath, ".gitignore"), "utf-8");
      expect(content).toBe(".tpdc/\n"); // unchanged
    });

    it("is idempotent for equivalent forms (`.tpdc`, `/.tpdc/`, `/.tpdc`)", async () => {
      for (const form of [".tpdc", "/.tpdc/", "/.tpdc"]) {
        const dir = await fs.mkdtemp(path.join(tempRoot, "eq-"));
        await fs.writeFile(path.join(dir, ".gitignore"), `${form}\n`);
        await ensureGitignored(dir, ".tpdc/");
        const content = await fs.readFile(path.join(dir, ".gitignore"), "utf-8");
        expect(content, `should be unchanged for form: ${form}`).toBe(`${form}\n`);
      }
    });

    it("ignores commented-out matches", async () => {
      // `# .tpdc/` is NOT an active ignore — should still append.
      await fs.writeFile(path.join(repoPath, ".gitignore"), "# .tpdc/\nfoo\n");
      await ensureGitignored(repoPath, ".tpdc/");

      const content = await fs.readFile(path.join(repoPath, ".gitignore"), "utf-8");
      expect(content).toBe("# .tpdc/\nfoo\n.tpdc/\n");
    });

    it("createWorktree auto-applies .gitignore (integration)", async () => {
      // Fresh repo, no .gitignore.
      const fresh = path.join(tempRoot, "auto-gi-repo");
      await fs.mkdir(fresh, { recursive: true });
      await gitInit(fresh);
      await fs.writeFile(path.join(fresh, "seed.txt"), "x");
      await execFileAsync("git", ["add", "."], { cwd: fresh });
      await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: fresh });

      const handle = await createWorktree({ repoRoot: fresh, runId: "auto-1" });

      const content = await fs.readFile(path.join(fresh, ".gitignore"), "utf-8");
      expect(content).toContain(".tpdc/");

      // Cleanup
      await removeWorktree(fresh, handle, { deleteBranch: true });
    });
  });
});
