"use strict";
/**
 * Plugin command: run-workflow
 *
 * Accepts free-text input and delegates to the existing workflow orchestrator.
 * Returns a rendered markdown summary suitable for product-facing output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkflowCommand = runWorkflowCommand;
const runWorkflowHandler_1 = require("../handlers/runWorkflowHandler");
const workflowMarkdown_1 = require("../renderers/workflowMarkdown");
async function runWorkflowCommand(text, options) {
    const input = { text };
    const result = await (0, runWorkflowHandler_1.runWorkflowHandler)(input, {
        llm: options.llm,
        quiet: options.quiet ?? true,
    });
    const markdown = (0, workflowMarkdown_1.renderWorkflowMarkdown)(result);
    return { markdown, result };
}
//# sourceMappingURL=runWorkflowCommand.js.map