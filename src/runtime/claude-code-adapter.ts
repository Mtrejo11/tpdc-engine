import { spawn } from "child_process";
import { execFileSync } from "child_process";
import { LLMAdapter, AdapterInfo } from "./types";

export interface ClaudeCodeAdapterOptions {
  model?: string;
  maxBudgetUsd?: number;
  claudePath?: string;
  timeoutMs?: number;
}

/**
 * LLM adapter that delegates to the Claude Code CLI (`claude --print`).
 * Uses the user's Claude Code Max subscription tokens instead of API credits.
 */
export class ClaudeCodeAdapter implements LLMAdapter {
  readonly modelId: string;
  readonly adapterInfo: AdapterInfo;
  private maxBudgetUsd: number;
  private claudePath: string;
  private timeoutMs: number;

  /** Raw stdout from the most recent call. Exposed for persistence. */
  lastRawStdout: string = "";

  constructor(options?: ClaudeCodeAdapterOptions) {
    this.modelId = options?.model ?? "sonnet";
    this.maxBudgetUsd = options?.maxBudgetUsd ?? 1;
    this.claudePath = options?.claudePath ?? "claude";
    this.timeoutMs = options?.timeoutMs ?? 300_000;
    this.adapterInfo = {
      adapterId: "claude-code-cli",
      modelId: this.modelId,
      transport: "cli",
    };

    // Verify claude binary exists at construction time
    this.verifyBinary();
  }

  private verifyBinary(): void {
    try {
      execFileSync("which", [this.claudePath], { stdio: "pipe" });
    } catch {
      throw new Error(
        `Claude Code CLI not found at "${this.claudePath}". ` +
        `Install it or set claudePath option to the correct path.`
      );
    }
  }

  async complete(prompt: string, input: string): Promise<string> {
    this.lastRawStdout = "";

    const stdinContent =
      input +
      "\n\nRespond with ONLY the spec.json content — a single valid JSON object. No markdown fences, no commentary, no spec.md. Just the JSON.";

    return new Promise<string>((resolve, reject) => {
      const args = [
        "--print",
        "--output-format", "text",
        "--model", this.modelId,
        "--max-budget-usd", String(this.maxBudgetUsd),
        "--append-system-prompt", prompt,
        "--no-session-persistence",
      ];

      // Unset CLAUDECODE to allow running inside a Claude Code session
      const env = { ...process.env };
      delete env.CLAUDECODE;

      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      const child = spawn(this.claudePath, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      // Timeout
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        settle(() =>
          reject(new Error(
            `Claude Code CLI timed out after ${this.timeoutMs}ms`
          ))
        );
      }, this.timeoutMs);

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const message = err.message.includes("ENOENT")
          ? `Claude Code CLI not found at "${this.claudePath}". Install it or set claudePath option.`
          : `Failed to spawn Claude Code CLI: ${err.message}`;
        settle(() => reject(new Error(message)));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        this.lastRawStdout = stdout;

        if (code !== 0) {
          settle(() =>
            reject(new Error(
              `Claude Code CLI exited with code ${code}\n${stderr.substring(0, 500)}`
            ))
          );
          return;
        }
        if (!stdout.trim()) {
          settle(() =>
            reject(new Error(
              `Claude Code CLI returned empty output\n${stderr.substring(0, 500)}`
            ))
          );
          return;
        }
        settle(() => resolve(stdout));
      });

      // Write the prompt to stdin and close it
      child.stdin.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code !== "EPIPE") {
          clearTimeout(timer);
          settle(() => reject(err));
        }
      });
      child.stdin.write(stdinContent);
      child.stdin.end();
    });
  }
}
