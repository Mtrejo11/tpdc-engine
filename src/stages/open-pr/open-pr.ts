/**
 * Open-PR stage — TPDC v2.
 *
 * Calls `gh pr create` with the body template rendered from artifacts.
 * Auth is delegated to gh's existing login (`gh auth status`).
 *
 * Why gh CLI rather than Octokit:
 *   - Zero new npm deps. gh is already installed in most dev environments.
 *   - Auth is invisible (gh handles tokens/refresh).
 *   - The CLI surface is stable and well-known.
 *
 * If gh is not installed (PATH miss), we detect via ENOENT and return
 * status "gh_missing" with a hint instead of failing the whole workflow.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { renderPRBody, renderPRTitle } from "./body-template.js";
import type { OpenPRRequest, OpenPRResult, OpenPRStatus } from "./open-pr.schema.js";

const execFileAsync = promisify(execFile);

const DEFAULT_BASE = "main";
const DEFAULT_TIMEOUT_MS = 60_000;
/** Match the URL format gh emits to stdout: https://github.com/<owner>/<repo>/pull/<n> */
const PR_URL_RE = /https?:\/\/[^\s]+\/pull\/(\d+)/;

export interface OpenPRDeps {
  execFileImpl?: typeof execFileAsync;
}

export async function runOpenPR(
  req: OpenPRRequest,
  deps: OpenPRDeps = {},
): Promise<OpenPRResult> {
  const t0 = Date.now();
  const baseBranch = req.baseBranch ?? DEFAULT_BASE;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFileImpl = deps.execFileImpl ?? execFileAsync;

  const ctx = {
    runId: req.runId,
    intake: req.intake,
    plan: req.plan,
    execute: req.execute,
    tests: req.tests,
  };
  const title = renderPRTitle(ctx);
  const body = renderPRBody(ctx);

  const args = [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--base",
    baseBranch,
    "--head",
    req.branch,
  ];
  if (req.draft) args.push("--draft");

  let status: OpenPRStatus = "failed";
  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  let prUrl = "";
  let prNumber = -1;
  let errorMessage: string | undefined;

  try {
    const result = await execFileImpl("gh", args, {
      cwd: req.repoRoot,
      timeout: timeoutMs,
    });
    stdout = String(result.stdout);
    stderr = String(result.stderr);
    exitCode = 0;

    const match = stdout.match(PR_URL_RE);
    if (match) {
      prUrl = match[0];
      prNumber = Number.parseInt(match[1] ?? "-1", 10);
      status = "opened";
    } else {
      // gh exited 0 but we couldn't parse a PR URL — unusual.
      status = "failed";
      errorMessage = "gh succeeded but no PR URL was found in stdout";
    }
  } catch (err: unknown) {
    const e = err as {
      code?: number | string | "ENOENT";
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    errorMessage = e.message;

    if (e.code === "ENOENT") {
      // gh binary not on PATH
      status = "gh_missing";
      exitCode = -1;
      errorMessage =
        "gh CLI not found on PATH. Install it (https://cli.github.com/) and run `gh auth login`.";
    } else if (e.killed === true || e.signal != null) {
      status = "errored";
      exitCode = -1;
    } else {
      status = "failed";
      exitCode = typeof e.code === "number" ? e.code : -1;
    }
  }

  return {
    runId: req.runId,
    status,
    prUrl,
    prNumber,
    branch: req.branch,
    baseBranch,
    title,
    body,
    stdout,
    stderr,
    exitCode,
    durationMs: Date.now() - t0,
    errorMessage,
  };
}
