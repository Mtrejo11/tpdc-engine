/**
 * Tests for tpdc_run_tests MCP wrapper. runTests is mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stages/run-tests/run-tests.js", () => ({
  runTests: vi.fn(),
}));

import { runTests } from "../../stages/run-tests/run-tests.js";
import { runTestsTool } from "./run-tests.js";

const parse = (t: string) => JSON.parse(t);

const validArgs = {
  runId: "r-1",
  worktreePath: "/tmp/wt",
  commands: ["npm test"],
};

const okResult = {
  runId: "r-1",
  status: "all_passed" as const,
  results: [
    {
      command: "npm test",
      status: "passed" as const,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
    },
  ],
  totalDurationMs: 100,
  summary: { total: 1, passed: 1, failed: 0, errored: 0 },
};

describe("runTestsTool", () => {
  beforeEach(() => vi.mocked(runTests).mockReset());

  it("has the expected name + required fields", () => {
    expect(runTestsTool.name).toBe("tpdc_run_tests");
    expect(runTestsTool.inputSchema.required).toEqual(["runId", "worktreePath", "commands"]);
  });

  it("passes through to runTests and returns JSON result", async () => {
    vi.mocked(runTests).mockResolvedValueOnce(okResult);
    const result = await runTestsTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    expect(vi.mocked(runTests)).toHaveBeenCalledOnce();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { status: string };
    expect(parsed.status).toBe("all_passed");
  });

  it("forwards optional timeoutMs + maxBufferBytes", async () => {
    vi.mocked(runTests).mockResolvedValueOnce(okResult);
    await runTestsTool.handler({ ...validArgs, timeoutMs: 30_000, maxBufferBytes: 2048 });
    const passed = vi.mocked(runTests).mock.calls[0]?.[0];
    expect(passed?.timeoutMs).toBe(30_000);
    expect(passed?.maxBufferBytes).toBe(2048);
  });

  it("rejects missing commands array", async () => {
    const result = await runTestsTool.handler({ runId: "r-1", worktreePath: "/tmp/wt" });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runTests)).not.toHaveBeenCalled();
  });

  it("rejects timeoutMs out of range", async () => {
    const result = await runTestsTool.handler({ ...validArgs, timeoutMs: 100 });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runTests)).not.toHaveBeenCalled();
  });

  it("does NOT set isError on failed status (legitimate test failure)", async () => {
    vi.mocked(runTests).mockResolvedValueOnce({
      ...okResult,
      status: "some_failed",
      summary: { total: 1, passed: 0, failed: 1, errored: 0 },
    });
    const result = await runTestsTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
  });

  it("isError:true on runTests throw", async () => {
    vi.mocked(runTests).mockRejectedValueOnce(new Error("worktree missing"));
    const result = await runTestsTool.handler(validArgs);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { error: string; stage: string };
    expect(parsed.error).toMatch(/worktree/);
    expect(parsed.stage).toBe("run-tests");
  });
});
