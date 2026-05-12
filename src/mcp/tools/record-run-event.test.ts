/**
 * Tests for tpdc_record_run_event MCP wrapper. recordRunEvent is mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../runs/record-event.js", () => ({
  recordRunEvent: vi.fn(),
}));

import { recordRunEvent } from "../../runs/record-event.js";
import { recordRunEventTool } from "./record-run-event.js";

const parse = (t: string) => JSON.parse(t);

const validExecute = {
  runId: "ship-001",
  repoRoot: "/tmp/repo",
  event: {
    eventType: "execute_complete",
    task: "Add sorting",
    status: "completed",
    branch: "tpdc/add-sorting-abc123",
    filesChanged: ["src/foo.tsx"],
    finalSummary: "Done.",
    toolCallCount: 10,
    turnCount: 5,
  },
};

const validCI = {
  runId: "ship-001",
  repoRoot: "/tmp/repo",
  event: {
    eventType: "ci_complete",
    conclusion: "success",
    localFixRetries: 0,
    ciFixRetries: 0,
  },
};

const okResult = {
  ok: true as const,
  path: "/tmp/repo/.tpdc/memory/runs/ship-001.md",
  created: true,
};

describe("recordRunEventTool", () => {
  beforeEach(() => vi.mocked(recordRunEvent).mockReset());

  it("has the expected name + required fields", () => {
    expect(recordRunEventTool.name).toBe("tpdc_record_run_event");
    expect(recordRunEventTool.inputSchema.required).toEqual(["runId", "repoRoot", "event"]);
  });

  it("validates and forwards an execute_complete event", async () => {
    vi.mocked(recordRunEvent).mockResolvedValueOnce(okResult);
    const result = await recordRunEventTool.handler(validExecute);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parse(block.text) as { ok: boolean; path: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBe(okResult.path);
    expect(vi.mocked(recordRunEvent)).toHaveBeenCalledOnce();
  });

  it("accepts ci_complete with optional retry fields", async () => {
    vi.mocked(recordRunEvent).mockResolvedValueOnce(okResult);
    const result = await recordRunEventTool.handler(validCI);
    expect(result.isError).toBeUndefined();
    const call = vi.mocked(recordRunEvent).mock.calls[0]?.[0];
    expect(call?.event.eventType).toBe("ci_complete");
  });

  it("rejects an unknown eventType (discriminated union fails)", async () => {
    const result = await recordRunEventTool.handler({
      runId: "r",
      repoRoot: "/tmp/repo",
      event: { eventType: "totally_made_up", foo: 1 },
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(recordRunEvent)).not.toHaveBeenCalled();
  });

  it("rejects execute_complete missing a required payload field", async () => {
    // Missing `branch`.
    const bad = {
      runId: "r",
      repoRoot: "/tmp/repo",
      event: {
        eventType: "execute_complete",
        task: "T",
        status: "completed",
        filesChanged: [],
        finalSummary: "",
        toolCallCount: 0,
        turnCount: 0,
      },
    };
    const result = await recordRunEventTool.handler(bad);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parse(block.text) as { ok: boolean; errors: Array<{ path: string }> };
    expect(parsed.ok).toBe(false);
    // Some Zod path component should reference `branch`.
    expect(parsed.errors.some((e) => e.path.endsWith("branch"))).toBe(true);
    expect(vi.mocked(recordRunEvent)).not.toHaveBeenCalled();
  });

  it("rejects empty runId at the input level", async () => {
    const result = await recordRunEventTool.handler({
      ...validExecute,
      runId: "",
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(recordRunEvent)).not.toHaveBeenCalled();
  });

  it("isError:true when helper returns ok:false (e.g., fs failure)", async () => {
    vi.mocked(recordRunEvent).mockResolvedValueOnce({
      ok: false,
      error: "EACCES: permission denied",
    });
    const result = await recordRunEventTool.handler(validCI);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parse(block.text) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("permission denied");
  });

  it("isError:true when helper throws unexpectedly", async () => {
    vi.mocked(recordRunEvent).mockRejectedValueOnce(new Error("boom"));
    const result = await recordRunEventTool.handler(validCI);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parse(block.text) as { ok: boolean; error: string };
    expect(parsed.error).toBe("boom");
  });

  it("rejects ci_complete with an invalid conclusion enum value", async () => {
    const result = await recordRunEventTool.handler({
      runId: "r",
      repoRoot: "/tmp/repo",
      event: {
        eventType: "ci_complete",
        conclusion: "MOSTLY_OK",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("accepts a halt event with stage + reason", async () => {
    vi.mocked(recordRunEvent).mockResolvedValueOnce(okResult);
    const result = await recordRunEventTool.handler({
      runId: "r",
      repoRoot: "/tmp/repo",
      event: {
        eventType: "halt",
        stage: "execute",
        reason: "max_turns_exceeded",
      },
    });
    expect(result.isError).toBeUndefined();
  });
});
