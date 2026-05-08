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
import type { ExecuteRequest, ExecuteResult, ExecuteStatus } from "./execute.schema.js";
import { EXECUTE_SYSTEM_PROMPT } from "./execute.prompt.js";
import {
  captureDiff,
  commitChanges,
  createWorktree,
  listChangedFiles,
  type WorktreeHandle,
} from "./worktree.js";

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_TOKENS_PER_TURN = 4096;
const TOOL_ERROR_LIMIT = 5;

interface RunExecuteOptions extends ExecuteRequest {
  client?: Anthropic;
}

export async function runExecute(opts: RunExecuteOptions): Promise<ExecuteResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_EXECUTOR_MODEL;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  // 1. Create worktree
  const handle = await createWorktree({
    repoRoot: opts.repoRoot,
    runId: opts.runId,
  });

  // 2. Build the initial user message: plan + reminder of where we are
  const userInput = [
    `# Run ID: ${opts.runId}`,
    `# Intake title: ${opts.intakeTitle}`,
    ``,
    `# Plan`,
    JSON.stringify(opts.plan, null, 2),
    ``,
    `# Worktree`,
    `You are operating in: ${handle.path}`,
    `Branch: ${handle.branch} (off ${handle.baseSha.slice(0, 12)})`,
    `All bash commands run with cwd=${handle.path}.`,
    `All text_editor paths are relative to the worktree.`,
  ].join("\n");

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
      system: EXECUTE_SYSTEM_PROMPT,
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
  let commitSha: string | undefined;
  let commitMessage: string | undefined;
  if (status === "completed" && filesChanged.length > 0) {
    commitMessage = opts.commitMessage ?? buildDefaultCommitMessage(opts.intakeTitle, opts.runId);
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

function buildDefaultCommitMessage(intakeTitle: string, runId: string): string {
  const title = intakeTitle.trim() || `tpdc: ${runId}`;
  return `${title}\n\nGenerated by TPDC v2 (run ${runId})`;
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
