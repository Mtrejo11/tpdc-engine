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
 *
 * Also performs silent housekeeping: ensures `.tpdc/` is in the target
 * repo's `.gitignore` (alpha.6 — dogfood-006 surfaced memory files
 * appearing as untracked changes). Idempotent.
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

  // Housekeeping: ensure .tpdc/ is gitignored before we create files under it.
  // Done before the mkdir so the .gitignore entry is in place when git first
  // sees the new directory tree. Safe to fail silently — if we can't write
  // .gitignore (read-only fs, weird perms), the worktree creation still works.
  try {
    await ensureGitignored(repoRoot, ".tpdc/");
  } catch (err) {
    process.stderr.write(
      `createWorktree: ensureGitignored failed (${(err as Error).message}); continuing\n`,
    );
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
 * Ensure that `entry` (e.g., `.tpdc/`) appears in `<repoRoot>/.gitignore`.
 *
 * Idempotent: checks for the entry under several equivalent forms (`.tpdc/`,
 * `/.tpdc/`, `.tpdc`, `/.tpdc`) before appending. Creates `.gitignore` if
 * absent. Appends a newline-separated entry so it lands on its own line.
 *
 * Exported for testing.
 */
export async function ensureGitignored(repoRoot: string, entry: string): Promise<void> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(gitignorePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // No .gitignore yet — fine, we'll create one.
  }

  // Treat `.tpdc/`, `/.tpdc/`, `.tpdc`, `/.tpdc` as equivalent. We also accept
  // a trailing `*` glob if the user customized it.
  const normalized = entry.replace(/^\/+/, "").replace(/\/+$/, "");
  const equivalents = new Set([
    entry,
    `/${entry}`,
    normalized,
    `/${normalized}`,
    `${normalized}/`,
    `/${normalized}/`,
  ]);

  const present = current.split("\n").some((line) => {
    const trimmed = line.split("#")[0]?.trim() ?? "";
    return trimmed.length > 0 && equivalents.has(trimmed);
  });

  if (present) return;

  const needsLeadingNewline = current.length > 0 && !current.endsWith("\n");
  const addition = `${needsLeadingNewline ? "\n" : ""}${entry}\n`;
  await fs.writeFile(gitignorePath, current + addition, "utf-8");
}

/**
 * Stage all changes (modifications + creates + deletes) in the worktree.
 *
 * Plain `git diff` does NOT include untracked files. To get a complete
 * diff against the base SHA, we stage everything first. The worktree is
 * ephemeral — mutating its index has no side effect on the parent repo
 * or the user's working tree.
 *
 * Idempotent: safe to call multiple times.
 */
async function stageAll(handle: WorktreeHandle): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: handle.path });
}

/**
 * Capture the unified diff of changes in the worktree against its base commit.
 * Includes both modifications to tracked files AND the full content of new
 * files created in the worktree.
 */
export async function captureDiff(handle: WorktreeHandle): Promise<string> {
  await stageAll(handle);
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", handle.baseSha],
    { cwd: handle.path },
  );
  return stdout;
}

/**
 * List files changed in the worktree relative to its base commit.
 * Returns relative paths. Includes both modified-tracked files AND new
 * untracked files created in the worktree.
 */
export async function listChangedFiles(handle: WorktreeHandle): Promise<string[]> {
  await stageAll(handle);
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-only", handle.baseSha],
    { cwd: handle.path },
  );
  return stdout.split("\n").filter((line) => line.length > 0);
}

export interface CommitChangesResult {
  /** True if a commit was created. False if nothing was staged to commit. */
  committed: boolean;
  /** SHA of the new commit. Undefined when committed=false. */
  sha?: string;
}

/**
 * Commit all changes in the worktree (staged + previously-untracked) under
 * the provided message. Idempotent against agent-side commits: if the agent
 * already committed everything during execute, this returns
 * `{ committed: false }` instead of erroring on "nothing to commit".
 *
 * Why this exists: stage 5 (push) needs the branch to have commits beyond
 * the base SHA so that `gh pr create` doesn't reject with
 * "No commits between <base> and <branch>". Stage 3 (execute) writes files
 * to the worktree but doesn't commit them by default — this helper closes
 * that gap.
 */
export async function commitChanges(
  handle: WorktreeHandle,
  message: string,
): Promise<CommitChangesResult> {
  // Stage anything the agent didn't already stage. Idempotent.
  await stageAll(handle);

  // If the index is empty (no staged changes), there's nothing to commit.
  // This happens when the agent itself ran `git commit` during execute, or
  // when the worktree truly has no changes.
  const { stdout: cachedDiff } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-only"],
    { cwd: handle.path },
  );
  if (cachedDiff.trim().length === 0) {
    return { committed: false };
  }

  await execFileAsync("git", ["commit", "-m", message], { cwd: handle.path });

  const { stdout: shaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: handle.path,
  });
  return { committed: true, sha: shaOut.trim() };
}

/**
 * Re-create a worktree at the original path if it was removed (e.g., by
 * push cleanup). The branch is expected to still exist locally — push uses
 * `deleteBranch: false` so the branch ref survives worktree removal.
 *
 * Idempotent: if the path still exists, returns the handle unchanged.
 *
 * Why this exists: stage 5 push removes the worktree directory on success.
 * Stage 8-remote (resolve-ci) needs to dispatch a fix-mode execute against
 * the same branch, but with the directory gone every git command in the
 * worktree fails with `spawn git ENOENT` (cwd doesn't exist). This helper
 * checkouts the branch into a fresh worktree at the original path.
 */
export async function restoreWorktree(
  repoRoot: string,
  handle: WorktreeHandle,
): Promise<WorktreeHandle> {
  try {
    await fs.access(handle.path);
    return handle;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await fs.mkdir(path.dirname(handle.path), { recursive: true });

  await execFileAsync(
    "git",
    ["worktree", "add", handle.path, handle.branch],
    { cwd: repoRoot },
  );

  return handle;
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
