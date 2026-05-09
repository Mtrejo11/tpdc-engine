/**
 * Execute stage — TPDC v2.
 *
 * Orchestrates the agentic execute loop:
 *   1. Create a git worktree under <repoRoot>/.tpdc/worktrees/<runId>/
 *   2. Open a tool-use loop with Sonnet 4.6 + bash + text_editor tools
 *      whose handlers operate on the worktree path
 *   3. Loop until the model emits no more tool_use blocks or MAX_TURNS hit
 *   4. Capture the diff against the base commit; return ExecuteResult
 *
 * The worktree is NOT cleaned up automatically — the workflow may want
 * to inspect it. Cleanup is the caller's responsibility (or stage 5: push).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import { DEFAULT_EXECUTOR_MODEL } from "../../runtime/executor.js";
import { runBashTool } from "./tools/bash.js";
import { runTextEditorTool } from "./tools/text-editor.js";
import type { ExecuteRequest, ExecuteResult, ExecuteStatus, FailureContext } from "./execute.schema.js";
import { EXECUTE_FIX_MODE_ADDENDUM, EXECUTE_SYSTEM_PROMPT } from "./execute.prompt.js";
import {
  captureDiff,
  commitChanges,
  createWorktree,
  listChangedFiles,
  type WorktreeHandle,
} from "./worktree.js";

const DEFAULT_MAX_TURNS = 60;
const DEFAULT_MAX_TOKENS_PER_TURN = 4096;
const TOOL_ERROR_LIMIT = 5;

/** Lightweight tool-call event used for mid-flight observability. */
export interface ToolCallEvent {
  /** 1-indexed turn within the agent loop. */
  turn: number;
  /** Tool name (e.g., "bash", "str_replace_based_edit_tool"). */
  toolName: string;
  /** First ~200 chars of the tool input, for human-readable log preview. */
  toolInputPreview: string;
}

interface RunExecuteOptions extends ExecuteRequest {
  client?: Anthropic;
  /**
   * Optional callback fired before each tool invocation. Used by the
   * workflow to emit `tpdc/execute.tool_call` events for Inngest UI
   * visibility (TPDC bug #3 from dogfooding ronda 1). Errors thrown
   * by the callback are caught and ignored — observability must never
   * break the agent loop.
   */
  onToolCall?: (event: ToolCallEvent) => void | Promise<void>;
}

const TOOL_INPUT_PREVIEW_CHARS = 200;

export async function runExecute(opts: RunExecuteOptions): Promise<ExecuteResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_EXECUTOR_MODEL;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const fixMode = opts.failureContext != null;

  // 1. Create or reuse worktree
  const handle: WorktreeHandle = opts.existingWorktree
    ?? (await createWorktree({
      repoRoot: opts.repoRoot,
      runId: opts.runId,
    }));

  // 2. Build the initial user message: plan + worktree + (fix-mode) failure context
  const systemPrompt = fixMode
    ? EXECUTE_SYSTEM_PROMPT + EXECUTE_FIX_MODE_ADDENDUM
    : EXECUTE_SYSTEM_PROMPT;

  const userInput = buildUserInput(opts, handle);

  const messages: MessageParam[] = [{ role: "user", content: userInput }];
  const tools = buildToolDefinitions();

  let toolCallCount = 0;
  let consecutiveToolErrors = 0;
  let totalIn = 0;
  let totalOut = 0;
  let lastModelId = model;
  let finalSummary = "";
  let status: ExecuteStatus = "max_turns_exceeded";

  // 3. Tool-use loop
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS_PER_TURN,
      system: systemPrompt,
      messages,
      tools,
    });

    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    lastModelId = response.model;

    // Append assistant message
    messages.push({ role: "assistant", content: response.content });

    // Detect refusal
    if (response.stop_reason === "refusal") {
      status = "model_refused";
      finalSummary = extractText(response.content) || "(model refused; no text content)";
      break;
    }

    // Collect tool uses
    const toolUses: ToolUseBlock[] = response.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // Done. The text content is our summary.
      status = "completed";
      finalSummary = extractText(response.content);
      break;
    }

    // Execute each tool call
    const toolResults: ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolCallCount++;

      // Mid-flight observability: notify the workflow before invoking the
      // tool. We never let the callback abort the loop; any error from it
      // is swallowed.
      if (opts.onToolCall) {
        try {
          await opts.onToolCall({
            turn: turn + 1,
            toolName: tu.name,
            toolInputPreview: previewToolInput(tu.input),
          });
        } catch {
          // ignore — observability errors must not affect the agent
        }
      }

      const handlerResult = await dispatchTool(tu, handle.path);

      if (handlerResult.isError) {
        consecutiveToolErrors++;
      } else {
        consecutiveToolErrors = 0;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: handlerResult.content,
        ...(handlerResult.isError ? { is_error: true } : {}),
      });
    }

    if (consecutiveToolErrors >= TOOL_ERROR_LIMIT) {
      status = "tool_error_loop";
      finalSummary = `Aborted: ${TOOL_ERROR_LIMIT} consecutive tool errors. Likely model is stuck.`;
      break;
    }

    messages.push({ role: "user", content: toolResults });
  }

  // 4. Capture results
  const diff = await captureDiff(handle);
  const filesChanged = await listChangedFiles(handle);

  if (status === "completed" && filesChanged.length === 0) {
    status = "no_changes";
  }

  // 5. Commit the agent's final state. Without this, push.ts has nothing
  // beyond the base SHA to send and `gh pr create` rejects with
  // "No commits between main and <branch>". commitChanges is idempotent
  // against the agent having already committed its own work.
  //
  // We also commit on max_turns_exceeded when the agent made progress —
  // the workflow can then push as a draft PR for human review instead of
  // discarding the partial work (TPDC bug #4 from dogfooding ronda 1).
  let commitSha: string | undefined;
  let commitMessage: string | undefined;
  const shouldCommit =
    filesChanged.length > 0 &&
    (status === "completed" || status === "max_turns_exceeded");
  if (shouldCommit) {
    commitMessage =
      opts.commitMessage ??
      buildDefaultCommitMessage(opts.intakeTitle, opts.runId, status);
    const commitResult = await commitChanges(handle, commitMessage);
    if (commitResult.committed) {
      commitSha = commitResult.sha;
    } else {
      // Agent already committed everything itself. We don't add an empty
      // commit. The branch still has commits; push.ts will work.
      commitMessage = undefined;
    }
  }

  return {
    runId: opts.runId,
    status,
    worktreePath: handle.path,
    branch: handle.branch,
    baseSha: handle.baseSha,
    commitSha,
    commitMessage,
    filesChanged,
    diff,
    finalSummary,
    toolCallCount,
    turnCount: messages.filter((m) => m.role === "assistant").length,
    usage: { inputTokens: totalIn, outputTokens: totalOut },
    model: lastModelId,
  };
}

function buildDefaultCommitMessage(
  intakeTitle: string,
  runId: string,
  status: ExecuteStatus,
): string {
  const title = intakeTitle.trim() || `tpdc: ${runId}`;
  if (status === "max_turns_exceeded") {
    return `WIP: ${title}\n\nAgent halted at max_turns — partial work, human review needed.\nGenerated by TPDC v2 (run ${runId})`;
  }
  return `${title}\n\nGenerated by TPDC v2 (run ${runId})`;
}

/** Per-tool-result content cap so fix-mode payloads don't blow up context. */
const FAILURE_OUTPUT_CHARS = 3000;

function buildUserInput(opts: ExecuteRequest, handle: WorktreeHandle): string {
  const sections: string[] = [
    `# Run ID: ${opts.runId}`,
    `# Intake title: ${opts.intakeTitle}`,
    ``,
    `# Plan`,
    JSON.stringify(opts.plan, null, 2),
    ``,
    `# Worktree`,
    `You are operating in: ${handle.path}`,
    `Branch: ${handle.branch} (off ${handle.baseSha.slice(0, 12)})`,
  ];

  if (opts.failureContext) {
    sections.push(``, formatFailureContext(opts.failureContext));
  }

  sections.push(
    ``,
    `All bash commands run with cwd=${handle.path}.`,
    `All text_editor paths are relative to the worktree.`,
  );

  return sections.join("\n");
}

function formatFailureContext(ctx: FailureContext): string {
  const parts: string[] = [
    `# Fix mode (attempt #${ctx.attempt})`,
    ``,
    `A previous execute attempt completed but validation tests failed.`,
    `Read each failure below, identify the gap, fix only what's needed, then stop.`,
    ``,
    `## Failing commands`,
  ];

  for (const cmd of ctx.previousCommands) {
    parts.push(``);
    parts.push(`### \`${cmd.command}\` (exit ${cmd.exitCode})`);
    if (cmd.stdout) {
      parts.push("**stdout:**", "```", truncateForContext(cmd.stdout), "```");
    }
    if (cmd.stderr) {
      parts.push("**stderr:**", "```", truncateForContext(cmd.stderr), "```");
    }
  }

  if (ctx.previousFinalSummary && ctx.previousFinalSummary.trim().length > 0) {
    parts.push(``, `## Previous attempt's summary`);
    parts.push(ctx.previousFinalSummary);
  }

  return parts.join("\n");
}

function truncateForContext(text: string): string {
  if (text.length <= FAILURE_OUTPUT_CHARS) return text;
  // Keep the tail — failure messages typically have the most useful info at the end.
  return `... (truncated ${text.length - FAILURE_OUTPUT_CHARS} chars)\n${text.slice(-FAILURE_OUTPUT_CHARS)}`;
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ToolHandlerResult {
  content: string;
  isError: boolean;
}

async function dispatchTool(tu: ToolUseBlock, worktreePath: string): Promise<ToolHandlerResult> {
  switch (tu.name) {
    case "bash":
      return runBashTool(tu.input as { command: string; description?: string }, { worktreePath });
    case "str_replace_based_edit_tool":
      return runTextEditorTool(
        tu.input as Parameters<typeof runTextEditorTool>[0],
        { worktreePath },
      );
    default:
      return {
        content: `Error: unknown tool "${tu.name}". Use bash or str_replace_based_edit_tool.`,
        isError: true,
      };
  }
}

function buildToolDefinitions(): Anthropic.Messages.MessageCreateParams["tools"] {
  return [
    {
      type: "bash_20250124",
      name: "bash",
    } as unknown as Anthropic.Messages.Tool,
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool",
    } as unknown as Anthropic.Messages.Tool,
  ];
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Render a tool's input as a short human-readable preview for observability
 * events. Strings are returned as-is (truncated); structured input is
 * JSON-stringified before truncation. Never throws.
 */
function previewToolInput(input: unknown): string {
  let raw: string;
  if (typeof input === "string") {
    raw = input;
  } else {
    try {
      raw = JSON.stringify(input);
    } catch {
      raw = "(non-serializable input)";
    }
  }
  return raw.length > TOOL_INPUT_PREVIEW_CHARS
    ? `${raw.slice(0, TOOL_INPUT_PREVIEW_CHARS)}...`
    : raw;
}
