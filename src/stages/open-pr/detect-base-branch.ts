/**
 * Detect the default branch of a repo.
 *
 * Tries `git symbolic-ref refs/remotes/origin/HEAD`, which resolves to
 * `refs/remotes/origin/<default-branch>` if the remote was cloned with
 * a default HEAD ref (most common case).
 *
 * Fallback chain:
 *   1. git symbolic-ref → strip prefix → return
 *   2. gh repo view --json defaultBranchRef → return
 *   3. "main" as final fallback
 *
 * Closes TODO #11 (baseBranch hardcoded to "main").
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_FALLBACK = "main";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface DetectBaseBranchOptions {
  repoRoot: string;
  /** Override fallback (default "main"). */
  fallback?: string;
  /** Per-command timeout (default 10s). */
  timeoutMs?: number;
}

export interface DetectBaseBranchDeps {
  execFileImpl?: typeof execFileAsync;
}

export interface DetectBaseBranchResult {
  branch: string;
  /** How the result was obtained: "git" | "gh" | "fallback". */
  source: "git" | "gh" | "fallback";
}

export async function detectBaseBranch(
  opts: DetectBaseBranchOptions,
  deps: DetectBaseBranchDeps = {},
): Promise<DetectBaseBranchResult> {
  const execFileImpl = deps.execFileImpl ?? execFileAsync;
  const fallback = opts.fallback ?? DEFAULT_FALLBACK;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Try git symbolic-ref (works if origin was cloned with HEAD)
  try {
    const { stdout } = await execFileImpl(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: opts.repoRoot, timeout },
    );
    const ref = String(stdout).trim();
    // Output like "origin/main" — strip the remote prefix
    const match = ref.match(/^origin\/(.+)$/);
    if (match?.[1]) {
      return { branch: match[1], source: "git" };
    }
  } catch {
    // Fall through to gh
  }

  // 2. Try gh CLI
  try {
    const { stdout } = await execFileImpl(
      "gh",
      ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
      { cwd: opts.repoRoot, timeout },
    );
    const branch = String(stdout).trim();
    if (branch.length > 0) {
      return { branch, source: "gh" };
    }
  } catch {
    // Fall through to default
  }

  return { branch: fallback, source: "fallback" };
}
