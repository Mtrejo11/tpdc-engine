/**
 * Run-tests stage types — TPDC v2.
 *
 * Stage 4 of the ship-feature workflow. Runs the validation commands
 * (tests, lint, typecheck) declared by plan.testCommands inside the
 * worktree produced by execute. Reports per-command results.
 */

export interface RunTestsRequest {
  runId: string;
  /** Absolute path to the worktree to run commands in. */
  worktreePath: string;
  /** Validation commands from plan.testCommands. */
  commands: string[];
  /** Per-command timeout in ms. Default 5 min. */
  timeoutMs?: number;
  /** Max bytes captured per stream. Default 256KB. */
  maxBufferBytes?: number;
}

export type CommandStatus = "passed" | "failed" | "errored";

export interface CommandResult {
  command: string;
  status: CommandStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Set on errored commands (timeout, signal, infra failure). */
  errorMessage?: string;
  /** Signal name if killed (e.g. "SIGTERM" on timeout). */
  signal?: string;
}

export type RunTestsStatus =
  /** Every command exited with code 0. */
  | "all_passed"
  /** At least one command exited non-zero (legitimate test failures, lint errors, etc.). */
  | "some_failed"
  /** No commands provided. */
  | "no_commands"
  /** At least one command was killed by signal/timeout/infra (could not be evaluated). */
  | "errored";

export interface RunTestsResult {
  runId: string;
  status: RunTestsStatus;
  results: CommandResult[];
  totalDurationMs: number;
  /** Counts useful for logging without iterating results. */
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
  };
}
