/**
 * Fetch CI failure logs — TPDC v2 (stage 7/8 helper).
 *
 * Wraps `gh run view --log-failed` to pull the logs of failed jobs for
 * the most recent CI run on a branch. Returns an array of CommandResult-
 * shaped entries that the auto-fix loop can feed into a FailureContext.
 *
 * Why gh CLI: same as stage 6 (open-pr) — zero new deps, reuses gh's
 * auth, stable surface. For v2 alpha this is sufficient.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LOG_CHARS = 8_000;

export interface FetchCILogsRequest {
  /** Absolute path to the user's repo (cwd for gh). */
  repoRoot: string;
  /** Branch whose latest CI run we want logs from. */
  branch: string;
  /** Per-command timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Cap on log length — agent context is finite. Default 8000 chars. */
  maxLogChars?: number;
}

export interface FetchCILogsResult {
  /** True if logs were retrieved (even if empty). False on infra error. */
  ok: boolean;
  /** Run ID from `gh run list --branch <branch>` if known. */
  runId?: string;
  /**
   * Single concatenated log blob from `gh run view --log-failed`. Truncated
   * to maxLogChars (tail-preserved — the failures usually live at the end).
   */
  logs: string;
  /** Error message if ok=false. */
  errorMessage?: string;
}

export interface FetchCILogsDeps {
  execFileImpl?: typeof execFileAsync;
}

export async function fetchCILogs(
  req: FetchCILogsRequest,
  deps: FetchCILogsDeps = {},
): Promise<FetchCILogsResult> {
  const execFileImpl = deps.execFileImpl ?? execFileAsync;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLogChars = req.maxLogChars ?? DEFAULT_MAX_LOG_CHARS;

  // Find the most recent run for this branch.
  let runId: string | undefined;
  try {
    const { stdout } = await execFileImpl(
      "gh",
      ["run", "list", "--branch", req.branch, "--limit", "1", "--json", "databaseId"],
      { cwd: req.repoRoot, timeout: timeoutMs },
    );
    const parsed = JSON.parse(String(stdout));
    if (Array.isArray(parsed) && parsed.length > 0) {
      runId = String(parsed[0]?.databaseId ?? "");
    }
    if (!runId) {
      return { ok: true, logs: "", errorMessage: "no recent run found for branch" };
    }
  } catch (err) {
    return {
      ok: false,
      logs: "",
      errorMessage: `gh run list failed: ${(err as Error).message}`,
    };
  }

  // Pull failed-job logs.
  try {
    const { stdout } = await execFileImpl(
      "gh",
      ["run", "view", runId, "--log-failed"],
      { cwd: req.repoRoot, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    const raw = String(stdout);
    const logs =
      raw.length > maxLogChars
        ? `... (truncated ${raw.length - maxLogChars} chars)\n${raw.slice(-maxLogChars)}`
        : raw;
    return { ok: true, runId, logs };
  } catch (err) {
    // Some failures (timeouts, the run had no failed jobs) end up here.
    return {
      ok: false,
      runId,
      logs: "",
      errorMessage: `gh run view --log-failed failed: ${(err as Error).message}`,
    };
  }
}
