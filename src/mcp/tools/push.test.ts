/**
 * Tests for tpdc_push MCP wrapper. runPush is mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stages/push/push.js", () => ({
  runPush: vi.fn(),
}));

import { runPush } from "../../stages/push/push.js";
import { pushTool } from "./push.js";

const parse = (t: string) => JSON.parse(t);

const validArgs = {
  runId: "r-1",
  repoRoot: "/tmp/repo",
  worktreePath: "/tmp/repo/.tpdc/worktrees/r-1",
  branch: "tpdc/run-r-1",
};

const okResult = {
  runId: "r-1",
  status: "pushed" as const,
  branch: "tpdc/run-r-1",
  remote: "origin",
  stdout: "ok",
  stderr: "",
  exitCode: 0,
  worktreeRemoved: true,
  durationMs: 250,
};

describe("pushTool", () => {
  beforeEach(() => vi.mocked(runPush).mockReset());

  it("has the expected name + required fields", () => {
    expect(pushTool.name).toBe("tpdc_push");
    expect(pushTool.inputSchema.required).toEqual(["runId", "repoRoot", "worktreePath", "branch"]);
  });

  it("calls runPush and returns the JSON result", async () => {
    vi.mocked(runPush).mockResolvedValueOnce(okResult);
    const result = await pushTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { status: string; branch: string };
    expect(parsed.status).toBe("pushed");
    expect(parsed.branch).toBe("tpdc/run-r-1");
  });

  it("forwards force=true to runPush (for auto-fix-CI)", async () => {
    vi.mocked(runPush).mockResolvedValueOnce(okResult);
    await pushTool.handler({ ...validArgs, force: true });
    expect(vi.mocked(runPush).mock.calls[0]?.[0]?.force).toBe(true);
  });

  it("forwards remote override", async () => {
    vi.mocked(runPush).mockResolvedValueOnce(okResult);
    await pushTool.handler({ ...validArgs, remote: "fork" });
    expect(vi.mocked(runPush).mock.calls[0]?.[0]?.remote).toBe("fork");
  });

  it("rejects missing branch", async () => {
    const result = await pushTool.handler({ ...validArgs, branch: "" });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runPush)).not.toHaveBeenCalled();
  });

  it("does NOT set isError on push failure status", async () => {
    vi.mocked(runPush).mockResolvedValueOnce({
      ...okResult,
      status: "failed",
      stderr: "permission denied",
      exitCode: 128,
    });
    const result = await pushTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
  });

  it("isError:true on runPush throw", async () => {
    vi.mocked(runPush).mockRejectedValueOnce(new Error("unreachable"));
    const result = await pushTool.handler(validArgs);
    expect(result.isError).toBe(true);
  });
});
