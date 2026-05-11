/**
 * Wait-CI stage — TPDC v0.3.
 *
 * Polls `gh run list --branch <branch> --json ...` until the most recent
 * workflow run for the branch reaches a terminal state, or `maxWaitMs`
 * elapses. Returns the final conclusion (success / failure / cancelled / ...)
 * plus the run's URL for downstream consumers.
 *
 * Why polling instead of webhooks: VISION.md §2 inmutable #1 — TPDC runs
 * entirely inside Claude Code as a plugin/MCP. No external server, no
 * tunnel, no webhook receiver. The agent calls this MCP tool and waits.
 *
 * Backoff strategy: start at `pollIntervalMs` (default 5s), multiply by
 * 1.5 each poll, cap at `maxPollIntervalMs` (default 30s). Total cap at
 * `maxWaitMs` (default 30 minutes).
 *
 * Resilience: transient `gh` failures (network glitch, rate-limit blip)
 * are absorbed and retried. After `MAX_CONSECUTIVE_GH_ERRORS` failures in
 * a row, returns status="errored" instead of waiting forever.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_INITIAL_DELAY_MS = 5_000;
const GH_COMMAND_TIMEOUT_MS = 30_000;
const MAX_CONSECUTIVE_GH_ERRORS = 3;

export interface WaitCIRequest {
  /** TPDC run identifier (carried through to the result for correlation). */
  runId: string;
  /** Absolute path to the user's repo (cwd for gh). */
  repoRoot: string;
  /** Branch whose latest workflow run to wait on. */
  branch: string;
  /**
   * Optional head commit SHA. When set, only runs with `headSha` matching
   * this value are considered. Useful when the branch may have multiple
   * runs (e.g., force-push retries) and you want to wait on a specific one.
   */
  headSha?: string;
  /** Initial poll interval in ms. Default 5000. Backed off ×1.5 each poll up to maxPollIntervalMs. */
  pollIntervalMs?: number;
  /** Cap on the per-poll wait. Default 30000. */
  maxPollIntervalMs?: number;
  /** Total wall-clock cap in ms. Default 30 minutes. */
  maxWaitMs?: number;
  /** Wait before the first poll (gives GH time to dispatch the run). Default 5000. */
  initialDelayMs?: number;
}

export type WaitCIStatus =
  /** A workflow run reached a terminal state. See `conclusion`. */
  | "completed"
  /** maxWaitMs elapsed before any terminal run was observed. */
  | "timeout"
  /**
   * gh failed `MAX_CONSECUTIVE_GH_ERRORS` times in a row (e.g., gh CLI not
   * installed, auth missing, repo not configured). Caller should surface
   * this distinctly from timeout — it's an infra problem.
   */
  | "errored";

/** GitHub's conclusion enum, mirrored. */
export type WaitCIConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral"
  | "action_required"
  | "timed_out"
  | "stale"
  | "startup_failure";

export interface WaitCIResult {
  runId: string;
  status: WaitCIStatus;
  /** GitHub workflow conclusion. Only set when status="completed". */
  conclusion?: WaitCIConclusion;
  /** Name of the workflow that ran (e.g., "CI"). */
  workflowName?: string;
  /** GitHub's numeric run identifier (the databaseId), for log fetching. */
  workflowRunId?: number;
  /** Direct URL to the run on GitHub. */
  url?: string;
  /** Branch name (echoed). */
  headBranch: string;
  /** Whether ANY run was ever seen for the branch during the wait. */
  sawAnyRun: boolean;
  /** Number of `gh run list` polls executed. */
  pollCount: number;
  /** Total wall-clock waited, ms. */
  durationMs: number;
  /** Last gh stderr text, useful when status="errored" or "timeout". */
  lastErrorMessage?: string;
}

export interface WaitCIDeps {
  /** Override execFile for tests. */
  execFileImpl?: typeof execFileAsync;
  /** Override sleep for tests (lets tests advance time deterministically). */
  sleep?: (ms: number) => Promise<void>;
  /** Override "now" for tests. Defaults to Date.now. */
  now?: () => number;
}

interface GhRunListEntry {
  databaseId: number;
  status: string;
  conclusion: string | null;
  workflowName: string;
  url: string;
  headSha: string;
  headBranch: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitCI(
  req: WaitCIRequest,
  deps: WaitCIDeps = {},
): Promise<WaitCIResult> {
  const execFileImpl = deps.execFileImpl ?? execFileAsync;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;

  const initialDelay = req.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  let pollInterval = req.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxInterval = req.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS;
  const maxWait = req.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  const t0 = now();
  let pollCount = 0;
  let consecutiveErrors = 0;
  let lastErrorMessage: string | undefined;
  let sawAnyRun = false;

  // Give GH time to dispatch the workflow run before the first poll.
  if (initialDelay > 0) await sleep(initialDelay);

  while (now() - t0 < maxWait) {
    pollCount++;

    let entries: GhRunListEntry[];
    try {
      const { stdout } = await execFileImpl(
        "gh",
        [
          "run",
          "list",
          "--branch",
          req.branch,
          "--limit",
          "5",
          "--json",
          "databaseId,status,conclusion,workflowName,url,headSha,headBranch",
        ],
        { cwd: req.repoRoot, timeout: GH_COMMAND_TIMEOUT_MS },
      );
      const raw = JSON.parse(String(stdout));
      entries = Array.isArray(raw) ? (raw as GhRunListEntry[]) : [];
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      lastErrorMessage = err instanceof Error ? err.message : String(err);
      if (consecutiveErrors >= MAX_CONSECUTIVE_GH_ERRORS) {
        return {
          runId: req.runId,
          status: "errored",
          headBranch: req.branch,
          sawAnyRun,
          pollCount,
          durationMs: now() - t0,
          lastErrorMessage,
        };
      }
      // Transient error — retry after backoff
      await sleep(pollInterval);
      pollInterval = Math.min(Math.floor(pollInterval * 1.5), maxInterval);
      continue;
    }

    // Pick the run that matches our criteria.
    const match = req.headSha
      ? entries.find((e) => e.headSha === req.headSha)
      : entries[0];

    if (match) {
      sawAnyRun = true;
      if (match.status === "completed") {
        return {
          runId: req.runId,
          status: "completed",
          conclusion: (match.conclusion ?? "neutral") as WaitCIConclusion,
          workflowName: match.workflowName,
          workflowRunId: match.databaseId,
          url: match.url,
          headBranch: match.headBranch,
          sawAnyRun: true,
          pollCount,
          durationMs: now() - t0,
        };
      }
      // status is in_progress / queued / requested / waiting — keep polling
    }

    await sleep(pollInterval);
    pollInterval = Math.min(Math.floor(pollInterval * 1.5), maxInterval);
  }

  // Timed out before any terminal run.
  return {
    runId: req.runId,
    status: "timeout",
    headBranch: req.branch,
    sawAnyRun,
    pollCount,
    durationMs: now() - t0,
    lastErrorMessage,
  };
}
