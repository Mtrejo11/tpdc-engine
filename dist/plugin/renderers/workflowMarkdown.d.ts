/**
 * Markdown renderer for workflow results.
 *
 * Produces a concise, human-friendly summary suitable for
 * product-facing output (chat, dashboard, report).
 */
import { WorkflowCommandResult } from "../handlers/runWorkflowHandler";
export declare function renderWorkflowMarkdown(result: WorkflowCommandResult): string;
