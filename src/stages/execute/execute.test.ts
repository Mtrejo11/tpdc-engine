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

import { buildBranchName, buildToolDefinitions } from "./execute.js";

// ── Branch name derivation (alpha.5) ────────────────────────────────

describe("buildBranchName", () => {
  it("slugs a plain English title with a short runId tail", () => {
    expect(
      buildBranchName(
        "Add sorting options for product list",
        "ship-20260511-234802-79c23c",
      ),
    ).toBe("tpdc/add-sorting-options-for-product-list-79c23c");
  });

  it("strips Spanish accents (NFKD) to keep branches ASCII", () => {
    expect(
      buildBranchName(
        "Mejorar diseño de la información",
        "ship-20260512-x-abc123",
      ),
    ).toBe("tpdc/mejorar-diseno-de-la-informacion-abc123");
  });

  it("collapses runs of punctuation/whitespace into single dashes", () => {
    expect(
      buildBranchName("Foo!! Bar—Baz / Qux", "ship-x-deadbe"),
    ).toBe("tpdc/foo-bar-baz-qux-deadbe");
  });

  it("trims leading + trailing dashes from the slug", () => {
    expect(
      buildBranchName("  !!!  Refactor cache layer  !!!  ", "ship-x-cafe01"),
    ).toBe("tpdc/refactor-cache-layer-cafe01");
  });

  it("caps the slug at 40 chars and re-trims any trailing dash", () => {
    const title = "Implement a very long descriptive feature name here";
    const branch = buildBranchName(title, "ship-x-aaaaaa");
    // Slug must be <= 40 chars (then -<6-char-tail>).
    const slug = branch.replace(/^tpdc\//, "").replace(/-aaaaaa$/, "");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to runId-based naming when title slugs to empty", () => {
    expect(buildBranchName("", "ship-20260511-79c23c")).toBe(
      "tpdc/run-ship-20260511-79c23c",
    );
    expect(buildBranchName("!!! @@@ ###", "ship-x-y")).toBe("tpdc/run-ship-x-y");
  });

  it("uses 'runid' literal tail when runId has no dashes", () => {
    expect(buildBranchName("Add feature", "plainrunid")).toBe(
      "tpdc/add-feature-plainr",
    );
  });
});

describe("buildToolDefinitions", () => {
  const opts = {
    advisorModel: "claude-opus-4-7",
    advisorMaxUses: 5,
    webSearchMaxUses: 3,
    webFetchMaxUses: 5,
  };

  it("returns exactly 6 tools (bash + text_editor + memory + web_search + web_fetch + advisor)", () => {
    const tools = buildToolDefinitions(opts);
    expect(tools).toHaveLength(6);
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
    // Note: advisor max_uses is a soft cap the platform may not strictly enforce;
    // dogfood-005 observed 16 invocations in a 16-turn run with max_uses=5.
    expect(adv.max_uses).toBe(5);
  });

  it("respects custom advisor model override", () => {
    const tools = buildToolDefinitions({
      advisorModel: "claude-opus-4-8-future",
      advisorMaxUses: 2,
      webSearchMaxUses: 3,
      webFetchMaxUses: 5,
    });
    const advisor = tools.find((t) => (t as { name: string }).name === "advisor");
    const adv = advisor as unknown as { model: string; max_uses: number };
    expect(adv.model).toBe("claude-opus-4-8-future");
    expect(adv.max_uses).toBe(2);
  });

  it("places client-side tools first, then web tools, advisor last (stable for snapshots)", () => {
    const tools = buildToolDefinitions(opts);
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names).toEqual([
      "bash",
      "str_replace_based_edit_tool",
      "memory",
      "web_search",
      "web_fetch",
      "advisor",
    ]);
  });

  it("includes the memory tool with the platform-canonical type tag", () => {
    const tools = buildToolDefinitions(opts);
    const memory = tools.find((t) => (t as { name: string }).name === "memory");
    expect(memory).toBeDefined();
    expect((memory as { type: string }).type).toBe("memory_20250818");
  });

  it("includes the web_search tool with the platform-canonical type tag + cap", () => {
    const tools = buildToolDefinitions(opts);
    const ws = tools.find((t) => (t as { name: string }).name === "web_search");
    expect(ws).toBeDefined();
    const w = ws as unknown as { type: string; max_uses: number };
    expect(w.type).toBe("web_search_20250305");
    expect(w.max_uses).toBe(3);
  });

  it("includes the web_fetch tool with the platform-canonical type tag + cap", () => {
    const tools = buildToolDefinitions(opts);
    const wf = tools.find((t) => (t as { name: string }).name === "web_fetch");
    expect(wf).toBeDefined();
    const w = wf as unknown as { type: string; max_uses: number };
    expect(w.type).toBe("web_fetch_20250910");
    expect(w.max_uses).toBe(5);
  });

  it("respects custom web tool max_uses overrides", () => {
    const tools = buildToolDefinitions({
      ...opts,
      webSearchMaxUses: 1,
      webFetchMaxUses: 2,
    });
    const ws = tools.find((t) => (t as { name: string }).name === "web_search");
    const wf = tools.find((t) => (t as { name: string }).name === "web_fetch");
    expect((ws as unknown as { max_uses: number }).max_uses).toBe(1);
    expect((wf as unknown as { max_uses: number }).max_uses).toBe(2);
  });

  it("marks ONLY the last tool with cache_control: ephemeral (prefix caching marker)", () => {
    const tools = buildToolDefinitions(opts);
    const cacheControls = tools.map(
      (t) => (t as { cache_control?: { type: string } }).cache_control,
    );
    // First five should have NO cache_control; the last (advisor) carries it.
    expect(cacheControls[0]).toBeUndefined();
    expect(cacheControls[1]).toBeUndefined();
    expect(cacheControls[2]).toBeUndefined();
    expect(cacheControls[3]).toBeUndefined();
    expect(cacheControls[4]).toBeUndefined();
    expect(cacheControls[5]).toEqual({ type: "ephemeral" });
  });
});
