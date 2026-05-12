/**
 * Tests for the execute stage's tool-definition + advisor wiring.
 *
 * The full agentic loop is exercised end-to-end by the gated integration
 * test and by the MCP wrapper tests (which fully mock runExecute). Here we
 * pin the pure surface: `buildToolDefinitions` returns the correct tools
 * with the right shape for the platform's advisor beta.
 *
 * See VISION.md §4 HIGH priority for the advisor tool rationale.
 */

import { describe, expect, it } from "vitest";

import { buildToolDefinitions } from "./execute.js";

describe("buildToolDefinitions", () => {
  const opts = { advisorModel: "claude-opus-4-7", advisorMaxUses: 5 };

  it("returns exactly 4 tools (bash + text_editor + memory + advisor)", () => {
    const tools = buildToolDefinitions(opts);
    expect(tools).toHaveLength(4);
  });

  it("includes the bash tool with the platform-canonical type tag", () => {
    const tools = buildToolDefinitions(opts);
    const bash = tools.find((t) => (t as { name: string }).name === "bash");
    expect(bash).toBeDefined();
    expect((bash as { type: string }).type).toBe("bash_20250124");
  });

  it("includes the text_editor tool with the platform-canonical type tag", () => {
    const tools = buildToolDefinitions(opts);
    const editor = tools.find(
      (t) => (t as { name: string }).name === "str_replace_based_edit_tool",
    );
    expect(editor).toBeDefined();
    expect((editor as { type: string }).type).toBe("text_editor_20250728");
  });

  it("includes the advisor tool with the beta type tag + configured model", () => {
    const tools = buildToolDefinitions(opts);
    const advisor = tools.find((t) => (t as { name: string }).name === "advisor");
    expect(advisor).toBeDefined();
    const adv = advisor as unknown as { type: string; model: string; max_uses: number };
    expect(adv.type).toBe("advisor_20260301");
    expect(adv.model).toBe("claude-opus-4-7");
    expect(adv.max_uses).toBe(5);
  });

  it("respects custom advisor model override", () => {
    const tools = buildToolDefinitions({ advisorModel: "claude-opus-4-8-future", advisorMaxUses: 2 });
    const advisor = tools.find((t) => (t as { name: string }).name === "advisor");
    const adv = advisor as unknown as { model: string; max_uses: number };
    expect(adv.model).toBe("claude-opus-4-8-future");
    expect(adv.max_uses).toBe(2);
  });

  it("places client-side tools first, advisor last (no functional reason but stable for snapshots)", () => {
    const tools = buildToolDefinitions(opts);
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names).toEqual(["bash", "str_replace_based_edit_tool", "memory", "advisor"]);
  });

  it("includes the memory tool with the platform-canonical type tag", () => {
    const tools = buildToolDefinitions(opts);
    const memory = tools.find((t) => (t as { name: string }).name === "memory");
    expect(memory).toBeDefined();
    expect((memory as { type: string }).type).toBe("memory_20250818");
  });

  it("marks ONLY the last tool with cache_control: ephemeral (prefix caching marker)", () => {
    const tools = buildToolDefinitions(opts);
    const cacheControls = tools.map(
      (t) => (t as { cache_control?: { type: string } }).cache_control,
    );
    // First three should have NO cache_control; the last (advisor) carries it.
    expect(cacheControls[0]).toBeUndefined();
    expect(cacheControls[1]).toBeUndefined();
    expect(cacheControls[2]).toBeUndefined();
    expect(cacheControls[3]).toEqual({ type: "ephemeral" });
  });
});
