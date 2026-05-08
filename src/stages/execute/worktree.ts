/**
 * Worktree helpers — TPDC v2.
 *
 * Wraps git worktree commands. Each TPDC run gets its own isolated worktree
 * under `<repoRoot>/.tpdc/worktrees/<runId>/` on a dedicated branch.
 * The agent executes against that worktree without touching the user's
 * working directory.
 *
 * See DECISIONS.md §D3 (worktrees over branches).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeHandle {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name created for this worktree */
  branch: string;
  /** Commit SHA the worktree was branched from */
  baseSha: string;
}

export interface CreateWorktreeOptions {
  repoRoot: string;
  runId: string;
  /** Base ref to branch from. Defaults to current HEAD. */
  baseRef?: string;
  /** Branch name override. Defaults to `tpdc/run-<runId>`. */
  branchName?: string;
}

/**
 * Create a new git worktree under <repoRoot>/.tpdc/worktrees/<runId>/.
 * Throws if repoRoot isn't a git repo, the runId already has a worktree, or git rejects.
 */
export async function createWorktree(opts: CreateWorktreeOptions): Promise<WorktreeHandle> {
  const { repoRoot, runId } = opts;
  const baseRef = opts.baseRef ?? "HEAD";
  const branch = opts.branchName ?? `tpdc/run-${runId}`;
  const wtPath = path.resolve(repoRoot, ".tpdc", "worktrees", runId);

  // Sanity: repoRoot must be a git repo
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: repoRoot });
  } catch {
    throw new Error(`createWorktree: ${repoRoot} is not a git repository`);
  }

  // Resolve baseRef to a stable SHA
  const { stdout: shaOut } = await execFileAsync("git", ["rev-parse", baseRef], { cwd: repoRoot });
  const baseSha = shaOut.trim();

  // Ensure the parent dir exists
  await fs.mkdir(path.dirname(wtPath), { recursive: true });

  // Refuse if worktree path already exists
  try {
    await fs.access(wtPath);
    throw new Error(`createWorktree: ${wtPath} already exists. Remove it first.`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Re-throw if it's not "doesn't exist"
      if (err instanceof Error && err.message.startsWith("createWorktree:")) throw err;
    }
  }

  // git worktree add -b <branch> <path> <baseSha>
  await execFileAsync("git", ["worktree", "add", "-b", branch, wtPath, baseSha], { cwd: repoRoot });

  return { path: wtPath, branch, baseSha };
}

/**
 * Capture the unified diff of changes in the worktree against its base commit.
 * Includes both committed and uncommitted changes.
 */
export async function captureDiff(handle: WorktreeHandle): Promise<string> {
  // Diff against the base SHA so we capture committed changes from the worktree
  // PLUS uncommitted changes (working tree).
  const { stdout: committedDiff } = await execFileAsync("git", ["diff", handle.baseSha], { cwd: handle.path });
  return committedDiff;
}

/**
 * List files changed in the worktree relative to its base commit.
 * Returns relative paths.
 */
export async function listChangedFiles(handle: WorktreeHandle): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", handle.baseSha],
    { cwd: handle.path },
  );
  return stdout.split("\n").filter((line) => line.length > 0);
}

/**
 * Remove the worktree and delete its branch (only if branch is unmerged
 * elsewhere — git refuses to delete a branch with unmerged commits otherwise).
 *
 * Soft-fails (logs to stderr) on any git error so cleanup never blocks the workflow.
 */
export async function removeWorktree(
  repoRoot: string,
  handle: WorktreeHandle,
  options: { deleteBranch?: boolean } = {},
): Promise<void> {
  const { deleteBranch = false } = options;

  try {
    await execFileAsync("git", ["worktree", "remove", "--force", handle.path], { cwd: repoRoot });
  } catch (err) {
    process.stderr.write(
      `removeWorktree: git worktree remove failed (${(err as Error).message}); continuing\n`,
    );
  }

  if (deleteBranch) {
    try {
      await execFileAsync("git", ["branch", "-D", handle.branch], { cwd: repoRoot });
    } catch (err) {
      process.stderr.write(
        `removeWorktree: git branch -D failed (${(err as Error).message}); continuing\n`,
      );
    }
  }
}
