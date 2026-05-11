/**
 * Tests for tpdc_fetch_ci_logs MCP wrapper. fetchCILogs is mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stages/run-tests/fetch-ci-logs.js", () => ({
  fetchCILogs: vi.fn(),
}));

import { fetchCILogs } from "../../stages/run-tests/fetch-ci-logs.js";
import { fetchCILogsTool } from "./fetch-ci-logs.js";

const parse = (t: string) => JSON.parse(t);

const validArgs = {
  repoRoot: "/tmp/repo",
  branch: "tpdc/run-r-1",
};

describe("fetchCILogsTool", () => {
  beforeEach(() => vi.mocked(fetchCILogs).mockReset());

  it("has the expected name + required fields", () => {
    expect(fetchCILogsTool.name).toBe("tpdc_fetch_ci_logs");
    expect(fetchCILogsTool.inputSchema.required).toEqual(["repoRoot", "branch"]);
  });

  it("returns the logs JSON on success", async () => {
    vi.mocked(fetchCILogs).mockResolvedValueOnce({
      ok: true,
      runId: "123456",
      logs: "Error: foo is not bar\n",
    });
    const result = await fetchCILogsTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { ok: boolean; logs: string; runId?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.logs).toContain("Error: foo");
    expect(parsed.runId).toBe("123456");
  });

  it("forwards optional timeoutMs + maxLogChars", async () => {
    vi.mocked(fetchCILogs).mockResolvedValueOnce({ ok: true, logs: "" });
    await fetchCILogsTool.handler({ ...validArgs, timeoutMs: 15_000, maxLogChars: 16_000 });
    const req = vi.mocked(fetchCILogs).mock.calls[0]?.[0];
    expect(req?.timeoutMs).toBe(15_000);
    expect(req?.maxLogChars).toBe(16_000);
  });

  it("does NOT set isError when fetchCILogs reports ok:false (valid outcome)", async () => {
    vi.mocked(fetchCILogs).mockResolvedValueOnce({
      ok: false,
      logs: "",
      errorMessage: "gh run list failed: gh: command not found",
    });
    const result = await fetchCILogsTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { ok: boolean; errorMessage?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.errorMessage).toMatch(/gh/);
  });

  it("rejects missing branch", async () => {
    const result = await fetchCILogsTool.handler({ repoRoot: "/tmp/repo" });
    expect(result.isError).toBe(true);
    expect(vi.mocked(fetchCILogs)).not.toHaveBeenCalled();
  });

  it("rejects timeoutMs out of range", async () => {
    const result = await fetchCILogsTool.handler({ ...validArgs, timeoutMs: 100 });
    expect(result.isError).toBe(true);
    expect(vi.mocked(fetchCILogs)).not.toHaveBeenCalled();
  });

  it("isError:true on fetchCILogs throw", async () => {
    vi.mocked(fetchCILogs).mockRejectedValueOnce(new Error("unexpected"));
    const result = await fetchCILogsTool.handler(validArgs);
    expect(result.isError).toBe(true);
  });
});
