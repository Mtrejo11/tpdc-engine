/**
 * Unit tests for the beta probe helper.
 *
 * The real API contract is exercised in `probe-beta.integration.test.ts`
 * (gated by ANTHROPIC_API_KEY). Here we pin the wiring: which API
 * surface (GA vs beta) the helper picks, what params it forwards, and
 * how it shapes successes vs. failures.
 */

import { describe, expect, it, vi } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

import { probeBetaConfig } from "./probe-beta.js";

const makeClient = (
  betaCreate: ReturnType<typeof vi.fn>,
  gaCreate: ReturnType<typeof vi.fn>,
) =>
  ({
    messages: { create: gaCreate },
    beta: { messages: { create: betaCreate } },
  }) as unknown as Anthropic;

describe("probeBetaConfig", () => {
  it("uses GA messages.create when no betas are supplied", async () => {
    const gaCreate = vi.fn().mockResolvedValue({
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });
    const betaCreate = vi.fn();
    const result = await probeBetaConfig({
      client: makeClient(betaCreate, gaCreate),
      model: "claude-opus-4-7",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.stopReason).toBe("end_turn");
    expect(gaCreate).toHaveBeenCalledOnce();
    expect(betaCreate).not.toHaveBeenCalled();
  });

  it("uses beta.messages.create when betas array is non-empty", async () => {
    const betaCreate = vi.fn().mockResolvedValue({
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });
    const gaCreate = vi.fn();
    const result = await probeBetaConfig({
      client: makeClient(betaCreate, gaCreate),
      model: "claude-opus-4-7",
      betas: ["advisor-tool-2026-03-01"],
    });
    expect(result.ok).toBe(true);
    expect(betaCreate).toHaveBeenCalledOnce();
    expect(gaCreate).not.toHaveBeenCalled();
    const args = betaCreate.mock.calls[0]?.[0] as { betas: string[] };
    expect(args.betas).toEqual(["advisor-tool-2026-03-01"]);
  });

  it("passes adaptive thinking and output_config.effort on the GA surface", async () => {
    const gaCreate = vi.fn().mockResolvedValue({
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });
    await probeBetaConfig({
      client: makeClient(vi.fn(), gaCreate),
      model: "claude-opus-4-7",
      thinking: { type: "adaptive" },
    });
    const args = gaCreate.mock.calls[0]?.[0] as {
      thinking: { type: string };
      output_config?: { effort?: string };
    };
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config?.effort).toBe("high");
  });

  it("passes through context_management on the beta surface", async () => {
    const betaCreate = vi.fn().mockResolvedValue({
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });
    await probeBetaConfig({
      client: makeClient(betaCreate, vi.fn()),
      model: "claude-opus-4-7",
      betas: ["context-management-2025-06-27"],
      contextManagement: {
        edits: [
          {
            type: "clear_tool_uses_20250919",
            trigger: { type: "input_tokens", value: 100000 },
          },
        ],
      },
    });
    const args = betaCreate.mock.calls[0]?.[0] as {
      context_management: { edits: Array<{ type: string }> };
    };
    expect(args.context_management.edits[0]?.type).toBe("clear_tool_uses_20250919");
  });

  it("returns { ok: false, error, status } when the API throws an APIError", async () => {
    class FakeAPIError extends Error {
      status = 400;
      constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, Anthropic.APIError.prototype);
      }
    }
    const gaCreate = vi
      .fn()
      .mockRejectedValue(new FakeAPIError("compact_20260112 is not a recognized type"));
    const result = await probeBetaConfig({
      client: makeClient(vi.fn(), gaCreate),
      model: "claude-opus-4-7",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("compact_20260112");
    expect(result.status).toBe(400);
  });

  it("returns { ok: false, error } for a non-API throw without crashing", async () => {
    const gaCreate = vi.fn().mockRejectedValue(new Error("network unreachable"));
    const result = await probeBetaConfig({
      client: makeClient(vi.fn(), gaCreate),
      model: "claude-opus-4-7",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("network unreachable");
    expect(result.status).toBeUndefined();
  });

  it("respects custom maxTokens override (for cheaper non-thinking probes)", async () => {
    const gaCreate = vi.fn().mockResolvedValue({
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });
    await probeBetaConfig({
      client: makeClient(vi.fn(), gaCreate),
      model: "claude-opus-4-7",
      maxTokens: 64,
    });
    const args = gaCreate.mock.calls[0]?.[0] as { max_tokens: number };
    expect(args.max_tokens).toBe(64);
  });

  it("forwards a tool array on the beta surface (for probing new beta tools)", async () => {
    const betaCreate = vi.fn().mockResolvedValue({
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
    });
    await probeBetaConfig({
      client: makeClient(betaCreate, vi.fn()),
      model: "claude-opus-4-7",
      betas: ["advisor-tool-2026-03-01"],
      tools: [
        // Cast through unknown because the test only cares about forwarding.
        { type: "advisor_20260301", name: "advisor", model: "claude-opus-4-7" } as unknown as never,
      ],
    });
    const args = betaCreate.mock.calls[0]?.[0] as { tools: Array<{ name: string }> };
    expect(args.tools[0]?.name).toBe("advisor");
  });
});
