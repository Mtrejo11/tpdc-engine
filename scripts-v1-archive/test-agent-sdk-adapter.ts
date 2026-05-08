#!/usr/bin/env npx tsx
/**
 * Test runner for the AgentSdkAdapter.
 *
 * Tests:
 * 1. Adapter instantiation and adapterInfo
 * 2. Structured JSON response via tool_use (requires ANTHROPIC_API_KEY)
 * 3. Integration with runCapability
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/test-agent-sdk-adapter.ts
 *   TPDC_MODEL=claude-haiku-4-5-20251001 ANTHROPIC_API_KEY=sk-... npx tsx scripts/test-agent-sdk-adapter.ts
 */

import { AgentSdkAdapter } from "../src/runtime/agent-sdk-adapter";
import { runCapability } from "../src/runtime/runCapability";

interface TestResult {
  name: string;
  pass: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`PASS (${ms}ms)`);
    results.push({ name, pass: true, durationMs: ms });
  } catch (err) {
    const ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`FAIL`);
    console.log(`    ${message}`);
    results.push({ name, pass: false, error: message, durationMs: ms });
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  const model = process.env.TPDC_MODEL || undefined;

  console.log(`\n========================================`);
  console.log(`  AgentSdkAdapter Test Suite`);
  console.log(`  Model: ${model || "default (claude-sonnet-4-20250514)"}`);
  console.log(`  API Key: ${process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET"}`);
  console.log(`========================================\n`);

  // --- Unit Tests (no API call) ---

  await test("instantiation with defaults", async () => {
    const adapter = new AgentSdkAdapter();
    assert(adapter.adapterInfo.adapterId === "agent-sdk", "adapterId should be agent-sdk");
    assert(adapter.adapterInfo.transport === "api", "transport should be api");
    assert(adapter.modelId === "claude-sonnet-4-20250514", "default model should be sonnet");
  });

  await test("instantiation with custom model", async () => {
    const adapter = new AgentSdkAdapter({ model: "claude-haiku-4-5-20251001" });
    assert(adapter.modelId === "claude-haiku-4-5-20251001", "model should be haiku");
    assert(adapter.adapterInfo.modelId === "claude-haiku-4-5-20251001", "adapterInfo model should match");
  });

  // --- Integration Tests (require API key) ---

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\n  Skipping API tests (ANTHROPIC_API_KEY not set)\n");
  } else {
    await test("complete() returns valid JSON via tool_use", async () => {
      const adapter = new AgentSdkAdapter({ model: model || "claude-haiku-4-5-20251001" });
      const result = await adapter.complete(
        "You are a JSON generator. Return a JSON object with the requested fields.",
        'Return a JSON object with fields: "name" (string), "count" (number), "active" (boolean).'
      );
      const parsed = JSON.parse(result);
      assert(typeof parsed.name === "string", "name should be string");
      assert(typeof parsed.count === "number", "count should be number");
      assert(typeof parsed.active === "boolean", "active should be boolean");
    });

    await test("complete() handles complex nested JSON", async () => {
      const adapter = new AgentSdkAdapter({ model: model || "claude-haiku-4-5-20251001" });
      const result = await adapter.complete(
        "You are a JSON generator. Return a JSON object with the requested structure.",
        'Return a JSON object with: "title" (string), "items" (array of objects with "id" number and "label" string), "metadata" (object with "version" string).'
      );
      const parsed = JSON.parse(result);
      assert(typeof parsed.title === "string", "title should be string");
      assert(Array.isArray(parsed.items), "items should be array");
      assert(typeof parsed.metadata === "object", "metadata should be object");
    });

    await test("runCapability with AgentSdkAdapter (intake)", async () => {
      const adapter = new AgentSdkAdapter({ model: model || "claude-haiku-4-5-20251001" });
      const input = {
        raw_request: "Users can't log in after password reset on mobile",
        source: "test-agent-sdk-adapter"
      };
      const result = await runCapability("intake", input, { llm: adapter, quiet: true });
      assert(result.output !== null, "output should not be null");
      assert(typeof result.output === "object", "output should be an object");
    });
  }

  // --- Summary ---
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log(`\n========================================`);
  console.log(`  Results: ${passed}/${results.length} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
