/**
 * Plugin command: run-workflow
 *
 * Accepts free-text input and delegates to the existing workflow orchestrator.
 * Returns a rendered markdown summary suitable for product-facing output.
 */
import { WorkflowCommandResult } from "../handlers/runWorkflowHandler";
import { LLMAdapter } from "../../runtime/types";
export interface RunWorkflowCommandOptions {
    llm: LLMAdapter;
    quiet?: boolean;
}
export declare function runWorkflowCommand(text: string, options: RunWorkflowCommandOptions): Promise<{
    markdown: string;
    result: WorkflowCommandResult;
}>;
