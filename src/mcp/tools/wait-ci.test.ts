/**
 * Tests for tpdc_wait_ci MCP wrapper. waitCI helper is mocked (its own
 * tests cover the polling/backoff logic).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stages/wait-ci/wait-ci.js", () => ({
  waitCI: vi.fn(),
}));

import { waitCI } from "../../stages/wait-ci/wait-ci.js";
import { waitCITool } from "./wait-ci.js";

const parse = (t: string) => JSON.parse(t);

const validArgs = {
  runId: "r-1",
  repoRoot: "/tmp/repo",
  branch: "tpdc/run-r-1",
};

const okResult = {
  runId: "r-1",
  status: "completed" as const,
  conclusion: "success" as const,
  workflowName: "CI",
  workflowRunId: 999,
  url: "https://github.com/owner/repo/actions/runs/999",
  headBranch: "tpdc/run-r-1",
  sawAnyRun: true,
  pollCount: 3,
  durationMs: 45_000,
};

describe("waitCITool", () => {
  beforeEach(() => vi.mocked(waitCI).mockReset());

  it("has the expected name + required fields", () => {
    expect(waitCITool.name).toBe("tpdc_wait_ci");
    expect(waitCITool.inputSchema.required).toEqual(["runId", "repoRoot", "branch"]);
  });

  it("returns JSON success result on completed/success", async () => {
    vi.mocked(waitCI).mockResolvedValueOnce(okResult);
    const result = await waitCITool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { status: string; conclusion: string; workflowRunId: number };
    expect(parsed.status).toBe("completed");
    expect(parsed.conclusion).toBe("success");
    expect(parsed.workflowRunId).toBe(999);
  });

  it("forwards optional headSha + intervals", async () => {
    vi.mocked(waitCI).mockResolvedValueOnce(okResult);
    await waitCITool.handler({
      ...validArgs,
      headSha: "abcdef",
      pollIntervalMs: 10_000,
      maxPollIntervalMs: 60_000,
      maxWaitMs: 600_000,
      initialDelayMs: 3_000,
    });
    const req = vi.mocked(waitCI).mock.calls[0]?.[0];
    expect(req?.headSha).toBe("abcdef");
    expect(req?.pollIntervalMs).toBe(10_000);
    expect(req?.maxPollIntervalMs).toBe(60_000);
    expect(req?.maxWaitMs).toBe(600_000);
    expect(req?.initialDelayMs).toBe(3_000);
  });

  it("does NOT set isError on completed/failure (CI red is a valid outcome)", async () => {
    vi.mocked(waitCI).mockResolvedValueOnce({
      ...okResult,
      conclusion: "failure",
    });
    const result = await waitCITool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { conclusion: string };
    expect(parsed.conclusion).toBe("failure");
  });

  it("does NOT set isError on timeout (valid outcome)", async () => {
    vi.mocked(waitCI).mockResolvedValueOnce({
      ...okResult,
      status: "timeout",
      conclusion: undefined,
      sawAnyRun: false,
    });
    const result = await waitCITool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { status: string };
    expect(parsed.status).toBe("timeout");
  });

  it("does NOT set isError on errored status (gh repeated failures — valid outcome)", async () => {
    vi.mocked(waitCI).mockResolvedValueOnce({
      ...okResult,
      status: "errored",
      lastErrorMessage: "gh: command not found",
    });
    const result = await waitCITool.handler(validArgs);
    expect(result.isError).toBeUndefined();
  });

  it("rejects missing branch", async () => {
    const result = await waitCITool.handler({ runId: "r-1", repoRoot: "/tmp" });
    expect(result.isError).toBe(true);
    expect(vi.mocked(waitCI)).not.toHaveBeenCalled();
  });

  it("rejects pollIntervalMs out of range", async () => {
    const result = await waitCITool.handler({ ...validArgs, pollIntervalMs: 100 });
    expect(result.isError).toBe(true);
    expect(vi.mocked(waitCI)).not.toHaveBeenCalled();
  });

  it("isError:true on waitCI throw", async () => {
    vi.mocked(waitCI).mockRejectedValueOnce(new Error("unexpected"));
    const result = await waitCITool.handler(validArgs);
    expect(result.isError).toBe(true);
  });
});
