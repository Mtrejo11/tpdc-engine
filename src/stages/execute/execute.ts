/**
 * Execute stage — TPDC v0.3.
 *
 * Orchestrates the agentic execute loop:
 *   1. Create a git worktree under <repoRoot>/.tpdc/worktrees/<runId>/
 *   2. Open a tool-use loop with Sonnet 4.6 + bash + text_editor + advisor
 *      tools whose handlers operate on the worktree path
 *   3. Loop until the model emits no more tool_use blocks or MAX_TURNS hit
 *   4. Capture the diff against the base commit; return ExecuteResult
 *
 * Platform integration (alpha.8):
 *   - Uses `client.beta.messages.create` (with `betas: [...]` for advisor
 *     and any future beta-flagged tools).
 *   - Tools include the advisor (`advisor_20260301`) — the platform invokes
 *     Opus 4.7 as a server-side sub-inference when Sonnet calls it. We do
 *     NOT dispatch advisor tool calls client-side; the API handles them.
 *   - Handles `stop_reason: "pause_turn"` by re-sending the assistant
 *     content to continue an in-flight server-side tool call.
 *
 * The worktree is NOT cleaned up automatically — the workflow may want
 * to inspect it. Cleanup is the caller's responsibility (or stage 5: push).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaTextBlock,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import { DEFAULT_ADVISOR_MODEL, DEFAULT_EXECUTOR_MODEL } from "../../runtime/executor.js";
import { runBashTool } from "./tools/bash.js";
import { runMemoryTool, type MemoryToolInput } from "./tools/memory.js";
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

/**
 * Beta flag for the advisor tool. Per VISION.md §4 HIGH priority: replaces
 * the manual two-call Opus escalation with a single-call server-side
 * sub-inference. The platform handles invocation; Sonnet just emits
 * server_tool_use blocks.
 */
const ADVISOR_TOOL_BETA = "advisor-tool-2026-03-01";

/**
 * Beta flag for the memory tool. Set conservatively — the SDK exposes
 * `BetaMemoryTool20250818` in its typed union, but the API may still gate
 * the runtime behavior on this header. If the platform later ungates,
 * removing this flag is a one-line change.
 */
const MEMORY_TOOL_BETA = "memory-tool-2025-08-18";

/** Cap advisor invocations per execute run to bound cost. */
const DEFAULT_ADVISOR_MAX_USES = 5;

/**
 * Prompt caching cache_control marker. Placed on the last tool definition
 * AND the system text block so the (system + tools) prefix becomes a single
 * cache entry. With the agentic loop firing 60 turns at the same prefix,
 * cache hits save 30-50% of input tokens (read at 0.1x base rate; the first
 * write costs 1.25x). See VISION.md §4 HIGH (alpha.11 / v0.4.0-alpha.0).
 *
 * Default TTL is 5m (ephemeral); the platform also offers 1h.
 */
const PROMPT_CACHE_CONTROL = { type: "ephemeral" as const };

/** Client-side tool names we know how to dispatch. Advisor is server-side and excluded. */
const CLIENT_SIDE_TOOL_NAMES = new Set([
  "bash",
  "str_replace_based_edit_tool",
  "memory",
]);

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
  /** Override advisor model. Defaults to DEFAULT_ADVISOR_MODEL (Opus 4.7). */
  advisorModel?: string;
  /** Cap on advisor invocations per execute run. Default 5. */
  advisorMaxUses?: number;
  /**
   * Optional callback fired before each client-side tool invocation. Used by
   * orchestrators to surface mid-flight progress. Errors thrown by the
   * callback are caught and ignored — observability must never break the
   * agent loop.
   */
  onToolCall?: (event: ToolCallEvent) => void | Promise<void>;
}

const TOOL_INPUT_PREVIEW_CHARS = 200;

export async function runExecute(opts: RunExecuteOptions): Promise<ExecuteResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_EXECUTOR_MODEL;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const advisorModel = opts.advisorModel ?? DEFAULT_ADVISOR_MODEL;
  const advisorMaxUses = opts.advisorMaxUses ?? DEFAULT_ADVISOR_MAX_USES;
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

  const messages: BetaMessageParam[] = [{ role: "user", content: userInput }];
  const tools = buildToolDefinitions({ advisorModel, advisorMaxUses });

  let toolCallCount = 0;
  let consecutiveToolErrors = 0;
  let totalIn = 0;
  let totalOut = 0;
  let cacheCreationIn = 0;
  let cacheReadIn = 0;
  let lastModelId = model;
  let finalSummary = "";
  let status: ExecuteStatus = "max_turns_exceeded";

  // 3. Tool-use loop
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS_PER_TURN,
      // System prompt is sent as a text-block array so we can attach
      // cache_control. The platform caches the (system + tools) prefix once
      // the cache entry is warm; subsequent turns read from cache at 0.1x
      // base rate. Only meaningful when the loop runs >= 2 turns.
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: PROMPT_CACHE_CONTROL,
        },
      ],
      messages,
      tools,
      betas: [ADVISOR_TOOL_BETA, MEMORY_TOOL_BETA],
    });

    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    // Cache usage tracking. The SDK exposes these on usage when prompt
    // caching is active. Both default to 0 when the response had no cache
    // interaction (e.g., a one-turn run or pre-cache code path).
    const u = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    cacheCreationIn += u.cache_creation_input_tokens ?? 0;
    cacheReadIn += u.cache_read_input_tokens ?? 0;
    lastModelId = response.model;

    // Append assistant message
    messages.push({ role: "assistant", content: response.content });

    // Detect refusal
    if (response.stop_reason === "refusal") {
      status = "model_refused";
      finalSummary = extractText(response.content) || "(model refused; no text content)";
      break;
    }

    // Handle pause_turn: a server-side tool (advisor, web_search, etc.) is
    // mid-invocation. Re-send the assistant content to continue. No tool
    // results to push — the platform owns the resolution.
    if (response.stop_reason === "pause_turn") {
      // The assistant content was already appended above; loop continues.
      continue;
    }

    // Collect CLIENT-SIDE tool uses (bash, text_editor). Server-side tools
    // like advisor emit `server_tool_use` blocks which aren't BetaToolUseBlock.
    const toolUses: BetaToolUseBlock[] = response.content.filter(
      (block): block is BetaToolUseBlock =>
        block.type === "tool_use" && CLIENT_SIDE_TOOL_NAMES.has(block.name),
    );

    if (toolUses.length === 0) {
      // Done. The text content is our summary.
      status = "completed";
      finalSummary = extractText(response.content);
      break;
    }

    // Execute each tool call
    const toolResults: BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolCallCount++;

      // Mid-flight observability: notify the orchestrator before invoking the
      // tool. Errors swallowed — observability must not break the agent.
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

      const handlerResult = await dispatchTool(tu, handle.path, opts.repoRoot);

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

  // 5. Commit the agent's final state (idempotent against the agent having
  // already committed). On max_turns, commit any progress as WIP so it can
  // be pushed as a draft PR for review.
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
    usage: {
      inputTokens: totalIn,
      outputTokens: totalOut,
      // Only surface cache fields when they're non-zero; keeps the JSON
      // clean for pre-cache callers reading the result.
      ...(cacheCreationIn > 0 ? { cacheCreationInputTokens: cacheCreationIn } : {}),
      ...(cacheReadIn > 0 ? { cacheReadInputTokens: cacheReadIn } : {}),
    },
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
    return `WIP: ${title}\n\nAgent halted at max_turns — partial work, human review needed.\nGenerated by TPDC v0.3 (run ${runId})`;
  }
  return `${title}\n\nGenerated by TPDC v0.3 (run ${runId})`;
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
  return `... (truncated ${text.length - FAILURE_OUTPUT_CHARS} chars)\n${text.slice(-FAILURE_OUTPUT_CHARS)}`;
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ToolHandlerResult {
  content: string;
  isError: boolean;
}

async function dispatchTool(
  tu: BetaToolUseBlock,
  worktreePath: string,
  repoRoot: string,
): Promise<ToolHandlerResult> {
  switch (tu.name) {
    case "bash":
      return runBashTool(tu.input as { command: string; description?: string }, { worktreePath });
    case "str_replace_based_edit_tool":
      return runTextEditorTool(
        tu.input as Parameters<typeof runTextEditorTool>[0],
        { worktreePath },
      );
    case "memory":
      return runMemoryTool(tu.input as MemoryToolInput, { repoRoot });
    default:
      // Should be unreachable — the loop filters tool_uses by client-side names
      // before dispatching. If we land here, the filter is out of sync.
      return {
        content: `Error: unknown client-side tool "${tu.name}". Expected bash, str_replace_based_edit_tool, or memory.`,
        isError: true,
      };
  }
}

interface ToolDefOpts {
  advisorModel: string;
  advisorMaxUses: number;
}

/**
 * Build the tool definitions passed to the beta messages API.
 *
 * Tools (in send order): bash, text_editor, memory, advisor.
 *
 * Memory is server-spec'd but client-dispatched — the platform routes
 * tool_use blocks to us; we read/write the local `/memories` directory.
 * Advisor is fully server-side (the platform calls Opus 4.7 for us).
 *
 * The LAST tool carries `cache_control` so the entire tools block becomes
 * part of the cached prefix (the platform applies cache_control transitively
 * to everything above the marked block). Paired with the system-prompt
 * cache_control in the loop body, this gives us a single cache entry for
 * the (system + tools) prefix that gets re-read every turn at 0.1x base
 * input rate.
 *
 * Exported for unit-testing the advisor + memory + cache wiring without an
 * end-to-end run.
 */
export function buildToolDefinitions(opts: ToolDefOpts): BetaToolUnion[] {
  return [
    {
      type: "bash_20250124",
      name: "bash",
    } as unknown as BetaToolUnion,
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool",
    } as unknown as BetaToolUnion,
    {
      // Memory tool — typed in SDK 0.78's BetaToolUnion (no cast needed).
      // Client implements the file-system ops; the platform routes
      // tool_use blocks with one of the 6 commands (view/create/...).
      type: "memory_20250818",
      name: "memory",
    },
    {
      // Advisor tool — server-side sub-inference. SDK 0.78 predates this beta,
      // so the cast is necessary. The API accepts it because we set
      // `betas: ['advisor-tool-2026-03-01']` on the request.
      // cache_control here marks the END of the prefix block; everything
      // above (bash + text_editor + memory + advisor itself) becomes one
      // cache entry.
      type: "advisor_20260301",
      name: "advisor",
      model: opts.advisorModel,
      max_uses: opts.advisorMaxUses,
      cache_control: PROMPT_CACHE_CONTROL,
    } as unknown as BetaToolUnion,
  ];
}

function extractText(content: BetaContentBlock[]): string {
  return content
    .filter((b): b is BetaTextBlock => b.type === "text")
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
