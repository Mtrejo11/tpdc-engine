/**
 * Push stage — TPDC v2.
 *
 * Pushes the worktree branch to the remote via `git push`. On success,
 * removes the worktree directory (but keeps the local branch ref so
 * later stages can re-create a worktree off it if needed — e.g.
 * stage 8 auto-fix-CI loop).
 *
 * Auth is delegated to the user's existing git credentials (SSH key,
 * credential helper, etc.). If the push fails because of auth, the
 * stderr will surface the reason.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { removeWorktree, type WorktreeHandle } from "../execute/worktree.js";
import type { PushRequest, PushResult, PushStatus } from "./push.schema.js";

const execFileAsync = promisify(execFile);

const DEFAULT_REMOTE = "origin";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface PushDeps {
  /** Override execFile (for tests). */
  execFileImpl?: typeof execFileAsync;
  /** Override removeWorktree (for tests / to disable cleanup). */
  removeWorktreeImpl?: typeof removeWorktree;
}

export async function runPush(
  req: PushRequest,
  deps: PushDeps = {},
): Promise<PushResult> {
  const t0 = Date.now();
  const remote = req.remote ?? DEFAULT_REMOTE;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFileImpl = deps.execFileImpl ?? execFileAsync;
  const removeWorktreeImpl = deps.removeWorktreeImpl ?? removeWorktree;

  const args = ["push", "-u"];
  if (req.force) args.push("--force-with-lease");
  args.push(remote, req.branch);

  let status: PushStatus = "failed";
  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  let errorMessage: string | undefined;

  try {
    const result = await execFileImpl("git", args, {
      cwd: req.worktreePath,
      timeout: timeoutMs,
    });
    stdout = String(result.stdout);
    stderr = String(result.stderr);
    exitCode = 0;
    status = "pushed";
  } catch (err: unknown) {
    const e = err as {
      code?: number | string;
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    const wasKilled = e.killed === true || e.signal != null;
    exitCode = typeof e.code === "number" ? e.code : -1;
    errorMessage = e.message;
    status = wasKilled ? "errored" : "failed";
  }

  // Cleanup worktree only on successful push. Failures leave the worktree
  // intact for human investigation.
  let worktreeRemoved = false;
  if (status === "pushed") {
    const handle: WorktreeHandle = {
      path: req.worktreePath,
      branch: req.branch,
      // baseSha not needed for removeWorktree
      baseSha: "",
    };
    try {
      // deleteBranch: false — branch ref stays local for stage 8 re-creation
      await removeWorktreeImpl(req.repoRoot, handle, { deleteBranch: false });
      worktreeRemoved = true;
    } catch (err) {
      // Soft fail: cleanup failure shouldn't fail the workflow
      worktreeRemoved = false;
      const msg = (err as Error).message;
      process.stderr.write(`runPush: worktree cleanup failed (${msg}); leaving in place\n`);
    }
  }

  return {
    runId: req.runId,
    status,
    branch: req.branch,
    remote,
    stdout,
    stderr,
    exitCode,
    worktreeRemoved,
    durationMs: Date.now() - t0,
    errorMessage,
  };
}
