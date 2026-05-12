/**
 * Run-event recorder (v0.4.0-alpha.9).
 *
 * Pure helper that appends a structured event section to a per-run
 * markdown summary at `<repoRoot>/.tpdc/memory/runs/<runId>.md`. This is
 * the canonical writer for the run summary — it replaces the
 * prompt-driven "agent please write to /memories/runs" pattern from
 * alpha.0–alpha.6 with a deterministic tool the orchestrating skill
 * (`/tpdc:ship`) invokes after each stage.
 *
 * Design:
 *   - Each call appends one `## <Section>` block to the file.
 *   - First call creates the file with a `# TPDC run <runId>` header.
 *   - Subsequent calls append; we never rewrite or de-dupe sections.
 *     If the same event fires twice, both records show up. That's the
 *     caller's bug to address — keeping the recorder dumb makes it
 *     auditable.
 *   - The parent dir is created lazily (mkdir recursive). The recorder
 *     does NOT manage `.gitignore` — that's worktree.ts's job (alpha.6).
 *
 * Events covered:
 *   - execute_complete  — what the executor produced.
 *   - tests_complete    — what the test stage observed.
 *   - pr_opened         — PR URL + number after the open-pr stage.
 *   - ci_complete       — final CI outcome (after wait-ci or auto-fix-ci).
 *   - halt              — the pipeline stopped mid-run; record where + why.
 *
 * The helper is intentionally NOT exported through any agent-facing
 * surface other than the MCP wrapper. Direct programmatic use happens
 * only in tests.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export type ExecuteStatus =
  | "completed"
  | "no_changes"
  | "max_turns_exceeded"
  | "tool_error_loop"
  | "model_refused";

export type TestsStatus = "all_passed" | "some_failed" | "errored" | "no_commands";

export type CIConclusion = "success" | "failure" | "timeout" | "skipped" | "cancelled";

export type HaltStage =
  | "intake"
  | "plan"
  | "execute"
  | "run-tests"
  | "push"
  | "open-pr"
  | "auto-fix-ci";

export interface ExecuteCompleteEvent {
  eventType: "execute_complete";
  /** Intake title — the human-readable task description. */
  task: string;
  status: ExecuteStatus;
  branch: string;
  filesChanged: string[];
  /** Last text response from the executor (truncated by caller if needed). */
  finalSummary: string;
  toolCallCount: number;
  turnCount: number;
}

export interface TestsCompleteEvent {
  eventType: "tests_complete";
  status: TestsStatus;
  /** Per-command pass/fail. Empty when status is `no_commands`. */
  commands: Array<{ command: string; passed: boolean }>;
}

export interface PROpenedEvent {
  eventType: "pr_opened";
  prUrl: string;
  prNumber: number;
  draft?: boolean;
  /** Set when the PR was opened as WIP after a non-clean execute. */
  wipReason?: string;
}

export interface CICompleteEvent {
  eventType: "ci_complete";
  conclusion: CIConclusion;
  localFixRetries?: number;
  ciFixRetries?: number;
}

export interface HaltEvent {
  eventType: "halt";
  stage: HaltStage;
  reason: string;
}

export type RunEvent =
  | ExecuteCompleteEvent
  | TestsCompleteEvent
  | PROpenedEvent
  | CICompleteEvent
  | HaltEvent;

export interface RecordRunEventInput {
  runId: string;
  /** Absolute path to the user's repo root. `.tpdc/` lives directly under it. */
  repoRoot: string;
  event: RunEvent;
}

export type RecordRunEventResult =
  | { ok: true; path: string; created: boolean }
  | { ok: false; error: string };

/** Per-run summary file path: `<repoRoot>/.tpdc/memory/runs/<runId>.md`. */
function summaryPath(repoRoot: string, runId: string): string {
  return path.join(repoRoot, ".tpdc", "memory", "runs", `${runId}.md`);
}

/** Truncate long free-text fields to keep summary files small + greppable. */
const FINAL_SUMMARY_CHARS = 1200;
function clip(text: string, max = FINAL_SUMMARY_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…\n*(truncated; full output in execute response)*`;
}

/** Render a single event into a markdown section. */
export function renderEventSection(event: RunEvent): string {
  switch (event.eventType) {
    case "execute_complete": {
      const files =
        event.filesChanged.length === 0
          ? "_(none — `no_changes` status)_"
          : event.filesChanged.map((f) => `- \`${f}\``).join("\n");
      return [
        `## Execute`,
        ``,
        `- **Task:** ${event.task}`,
        `- **Status:** ${event.status}`,
        `- **Branch:** \`${event.branch}\``,
        `- **Tool calls:** ${event.toolCallCount} across ${event.turnCount} turns`,
        ``,
        `### Files changed (${event.filesChanged.length})`,
        files,
        ``,
        `### Final summary`,
        ``,
        clip(event.finalSummary || "_(executor returned no text)_"),
      ].join("\n");
    }
    case "tests_complete": {
      const lines = [`## Tests`, ``, `- **Status:** ${event.status}`];
      if (event.commands.length > 0) {
        lines.push(``, `### Commands`);
        for (const c of event.commands) {
          lines.push(`- ${c.passed ? "✓" : "✗"} \`${c.command}\``);
        }
      }
      return lines.join("\n");
    }
    case "pr_opened": {
      const lines = [
        `## PR`,
        ``,
        `- **URL:** ${event.prUrl}`,
        `- **Number:** ${event.prNumber}`,
      ];
      if (event.draft !== undefined) lines.push(`- **Draft:** ${event.draft}`);
      if (event.wipReason) lines.push(`- **WIP reason:** ${event.wipReason}`);
      return lines.join("\n");
    }
    case "ci_complete": {
      const lines = [`## CI`, ``, `- **Conclusion:** ${event.conclusion}`];
      if (event.localFixRetries !== undefined)
        lines.push(`- **Local fix retries:** ${event.localFixRetries}`);
      if (event.ciFixRetries !== undefined)
        lines.push(`- **CI fix retries:** ${event.ciFixRetries}`);
      return lines.join("\n");
    }
    case "halt": {
      return [
        `## Halt`,
        ``,
        `- **Stage:** ${event.stage}`,
        `- **Reason:** ${event.reason}`,
      ].join("\n");
    }
  }
}

/**
 * Append `event` to `<repoRoot>/.tpdc/memory/runs/<runId>.md`.
 *
 * On first call, creates the file with a top-level `# TPDC run <runId>`
 * header. On subsequent calls, appends the new section after a blank
 * line. The recorder does NOT dedupe — duplicate events from a buggy
 * caller will produce duplicate sections (caught in review, not papered
 * over here).
 *
 * Errors bubble up as `{ ok: false, error }`. We never throw — the
 * orchestrating skill should be able to inspect the failure and decide.
 */
export async function recordRunEvent(
  input: RecordRunEventInput,
): Promise<RecordRunEventResult> {
  const { runId, repoRoot, event } = input;
  if (!runId || runId.trim().length === 0) {
    return { ok: false, error: "runId is required (non-empty string)" };
  }
  if (!repoRoot || repoRoot.trim().length === 0) {
    return { ok: false, error: "repoRoot is required (non-empty string)" };
  }

  const filePath = summaryPath(repoRoot, runId);
  const dirPath = path.dirname(filePath);

  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to create runs directory: ${(err as Error).message}`,
    };
  }

  let current = "";
  let created = false;
  try {
    current = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, error: `Failed to read summary file: ${(err as Error).message}` };
    }
    created = true;
    current = `# TPDC run ${runId}\n`;
  }

  const section = renderEventSection(event);
  // Ensure exactly one blank line between sections.
  const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  const next = `${current}${separator}${section}\n`;

  try {
    await fs.writeFile(filePath, next, "utf-8");
  } catch (err) {
    return { ok: false, error: `Failed to write summary file: ${(err as Error).message}` };
  }

  return { ok: true, path: filePath, created };
}
