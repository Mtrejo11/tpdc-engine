/**
 * Bash tool handler — TPDC v2.
 *
 * Executes bash commands inside a worktree. Used by the execute stage's agent loop.
 * Safety: deny patterns block obviously dangerous commands; per-command timeout;
 * stdout/stderr capped to prevent context blowup.
 *
 * This handler implements the contract for Anthropic's `bash_20250124` tool.
 * Returns content the model receives as a tool_result.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Patterns that block a command outright. Conservative; can be tuned per-deployment. */
export const DEFAULT_DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-r[fF]?|--recursive)/, // rm -rf and friends
  /\bsudo\b/,
  /\bcurl\s+[^|]*\|\s*(sh|bash)/, // curl ... | sh
  /\bwget\s+[^|]*\|\s*(sh|bash)/, // wget ... | sh
  /\bdd\s+if=/, // dd if=...
  /\bmkfs\b/, // filesystem creation
  /:\(\)\s*\{.*:\|:&/, // fork bomb shape
  /\bgit\s+push\s+--force/, // force push (we never want this from within an agent loop)
];

export interface BashToolInput {
  command: string;
  /** Optional descriptive label. Anthropic's tool spec sometimes includes this. */
  description?: string;
}

export interface BashToolDeps {
  worktreePath: string;
  /** Per-command timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Max bytes captured per stream. Default 64KB. */
  maxBufferBytes?: number;
  /** Override deny patterns (e.g. for tests). */
  denyPatterns?: RegExp[];
  /** Override exec function (for tests). */
  execImpl?: typeof execAsync;
}

export interface BashToolResult {
  /** Content string returned to the model as tool_result.content */
  content: string;
  /** True if this should be marked as is_error in the tool_result */
  isError: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 64 * 1024;

export async function runBashTool(
  input: BashToolInput,
  deps: BashToolDeps,
): Promise<BashToolResult> {
  const command = input.command;
  if (typeof command !== "string" || command.length === 0) {
    return {
      content: "Error: bash tool requires a non-empty `command` string.",
      isError: true,
    };
  }

  const denyPatterns = deps.denyPatterns ?? DEFAULT_DENY_PATTERNS;
  for (const pattern of denyPatterns) {
    if (pattern.test(command)) {
      return {
        content:
          `Error: command blocked by deny pattern (${pattern.toString()}). ` +
          `If this is a false positive, refine your approach instead.`,
        isError: true,
      };
    }
  }

  const execImpl = deps.execImpl ?? execAsync;
  const timeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = deps.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

  try {
    const { stdout, stderr } = await execImpl(command, {
      cwd: deps.worktreePath,
      timeout,
      maxBuffer,
    });

    return {
      content: formatOutput({ exitCode: 0, stdout, stderr }),
      isError: false,
    };
  } catch (err: unknown) {
    // execAsync throws on non-zero exit, killed (signal), or buffer overflow
    const e = err as { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
    const exitCode =
      typeof e.code === "number" ? e.code : e.killed ? -1 : typeof e.code === "string" ? -1 : -1;

    return {
      content: formatOutput({
        exitCode,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "",
        signal: e.signal,
      }),
      // Non-zero exit isn't always a "tool error" — sometimes the model wants to
      // see test failures, lint errors, etc. We surface it as content but DON'T
      // mark is_error unless the command failed to run at all (signal, timeout).
      isError: e.killed === true || e.signal != null,
    };
  }
}

function formatOutput(parts: {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
}): string {
  const lines: string[] = [`[exit ${parts.exitCode}${parts.signal ? `, signal=${parts.signal}` : ""}]`];
  if (parts.stdout) lines.push("stdout:", parts.stdout.trimEnd());
  if (parts.stderr) lines.push("stderr:", parts.stderr.trimEnd());
  if (!parts.stdout && !parts.stderr) lines.push("(no output)");
  return lines.join("\n");
}
