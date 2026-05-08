/**
 * Push stage types — TPDC v2.
 *
 * Stage 5: push the worktree branch to the remote, then clean up the
 * worktree directory. The branch ref stays so stage 8 (auto-fix-CI loop)
 * can re-create a fresh worktree off it if needed.
 */

export interface PushRequest {
  runId: string;
  /** Absolute path to the user's repo (parent of the worktree). */
  repoRoot: string;
  /** Absolute path to the worktree being pushed. */
  worktreePath: string;
  /** Branch name to push. */
  branch: string;
  /** Remote name. Default "origin". */
  remote?: string;
  /** If true, force push (used for auto-fix-CI loop). Default false. */
  force?: boolean;
  /** Per-command timeout. Default 60s. */
  timeoutMs?: number;
}

export type PushStatus =
  /** Branch pushed and worktree cleaned up. */
  | "pushed"
  /** git push exited non-zero (auth failure, branch protections, etc.). */
  | "failed"
  /** git push timed out or was killed. */
  | "errored";

export interface PushResult {
  runId: string;
  status: PushStatus;
  branch: string;
  remote: string;
  /** Stdout from the push command (empty on errored). */
  stdout: string;
  /** Stderr from the push command. */
  stderr: string;
  /** Exit code; -1 on signal/timeout. */
  exitCode: number;
  /** True if the worktree directory was successfully removed post-push. */
  worktreeRemoved: boolean;
  durationMs: number;
  /** Error message on errored status. */
  errorMessage?: string;
}
