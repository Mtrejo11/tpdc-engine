#!/usr/bin/env npx ts-node
/**
 * Local test runner for the plugin workflow command.
 *
 * Usage:
 *   npx ts-node scripts/test-plugin.ts "Users are complaining about uploads"
 *   TPDC_ADAPTER=mock npx ts-node scripts/test-plugin.ts "test input"
 */

import { runWorkflowCommand } from "../src/plugin";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";
import { ClaudeAdapter } from "../src/runtime/claude-adapter";
import { MockLLMAdapter, LLMAdapter } from "../src/runtime/types";

function createAdapter(): LLMAdapter {
  const adapterEnv = process.env.TPDC_ADAPTER;
  const model = process.env.TPDC_MODEL || undefined;

  if (adapterEnv === "mock") return new MockLLMAdapter();
  if (adapterEnv === "api" || process.env.ANTHROPIC_API_KEY) return new ClaudeAdapter({ model });
  return new ClaudeCodeAdapter({ model });
}

async function main() {
  const text = process.argv[2];
  if (!text) {
    console.error("Usage: npx ts-node scripts/test-plugin.ts \"<request text>\"");
    process.exit(1);
  }

  console.log(`[Plugin Test] Input: "${text}"\n`);

  const llm = createAdapter();
  const { markdown, result } = await runWorkflowCommand(text, { llm });

  console.log(markdown);
  console.log(`---\nWorkflow ID: ${result.workflowId}`);
  console.log(`Artifacts: artifacts/${result.workflowId}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
