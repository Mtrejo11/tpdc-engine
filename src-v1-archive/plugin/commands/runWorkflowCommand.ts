/**
 * Plugin command: run-workflow
 *
 * Accepts free-text input and delegates to the existing workflow orchestrator.
 * Returns a rendered markdown summary suitable for product-facing output.
 */

import { runWorkflowHandler, WorkflowCommandInput, WorkflowCommandResult } from "../handlers/runWorkflowHandler";
import { renderWorkflowMarkdown } from "../renderers/workflowMarkdown";
import { LLMAdapter } from "../../runtime/types";

export interface RunWorkflowCommandOptions {
  llm: LLMAdapter;
  quiet?: boolean;
}

export async function runWorkflowCommand(
  text: string,
  options: RunWorkflowCommandOptions,
): Promise<{ markdown: string; result: WorkflowCommandResult }> {
  const input: WorkflowCommandInput = { text };

  const result = await runWorkflowHandler(input, {
    llm: options.llm,
    quiet: options.quiet ?? true,
  });

  const markdown = renderWorkflowMarkdown(result);

  return { markdown, result };
}
