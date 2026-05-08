/**
 * Run-tests stage — TPDC v2.
 *
 * Executes plan.testCommands one by one in the worktree. Returns per-command
 * results plus an aggregate status. Does NOT use the bash *agent tool* from
 * stage 3 — that one is for the model to use; this is direct execution
 * with longer timeouts and tighter result shape.
 *
 * Safety: applies the same deny-pattern check as the bash tool handler so
 * a misconfigured plan can't accidentally run something destructive.
 *
 * See DECISIONS.md §D4 (v2 scope = "PR + CI green") — local validation is
 * the precursor to CI, and the auto-fix-CI loop in stage 8 will reuse this
 * primitive.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

import { DEFAULT_DENY_PATTERNS } from "../execute/tools/bash.js";
import type {
  CommandResult,
  CommandStatus,
  RunTestsRequest,
  RunTestsResult,
  RunTestsStatus,
} from "./run-tests.schema.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per command
const DEFAULT_MAX_BUFFER = 256 * 1024; // 256 KB per stream

export interface RunTestsDeps {
  /** Override exec function (for tests). */
  execImpl?: typeof execAsync;
  /** Override deny patterns (for tests / per-deployment override). */
  denyPatterns?: RegExp[];
}

export async function runTests(
  req: RunTestsRequest,
  deps: RunTestsDeps = {},
): Promise<RunTestsResult> {
  const t0 = Date.now();
  const execImpl = deps.execImpl ?? execAsync;
  const denyPatterns = deps.denyPatterns ?? DEFAULT_DENY_PATTERNS;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = req.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

  if (req.commands.length === 0) {
    return {
      runId: req.runId,
      status: "no_commands",
      results: [],
      totalDurationMs: 0,
      summary: { total: 0, passed: 0, failed: 0, errored: 0 },
    };
  }

  const results: CommandResult[] = [];

  for (const command of req.commands) {
    // Deny-pattern guard
    const denied = denyPatterns.find((p) => p.test(command));
    if (denied) {
      results.push({
        command,
        status: "errored",
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        errorMessage: `Blocked by deny pattern (${denied.toString()})`,
      });
      continue;
    }

    const start = Date.now();
    try {
      const { stdout, stderr } = await execImpl(command, {
        cwd: req.worktreePath,
        timeout: timeoutMs,
        maxBuffer,
      });
      results.push({
        command,
        status: "passed",
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    } catch (err: unknown) {
      const e = err as {
        code?: number | string;
        killed?: boolean;
        signal?: string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const durationMs = Date.now() - start;
      const wasKilled = e.killed === true || e.signal != null;

      const status: CommandStatus = wasKilled ? "errored" : "failed";
      const exitCode = typeof e.code === "number" ? e.code : -1;

      results.push({
        command,
        status,
        exitCode,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "",
        durationMs,
        errorMessage: wasKilled ? (e.message ?? "killed") : undefined,
        signal: e.signal,
      });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    errored: results.filter((r) => r.status === "errored").length,
  };

  const status: RunTestsStatus =
    summary.errored > 0
      ? "errored"
      : summary.failed > 0
        ? "some_failed"
        : "all_passed";

  return {
    runId: req.runId,
    status,
    results,
    totalDurationMs: Date.now() - t0,
    summary,
  };
}
