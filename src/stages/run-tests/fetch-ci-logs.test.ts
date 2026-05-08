import { describe, expect, it, vi } from "vitest";
import { fetchCILogs } from "./fetch-ci-logs.js";

describe("fetchCILogs", () => {
  it("returns logs for the most recent run on the branch", async () => {
    const execFileMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '[{"databaseId": 12345}]\n', stderr: "" })
      .mockResolvedValueOnce({ stdout: "test failure: assertion failed\n", stderr: "" });

    const result = await fetchCILogs(
      { repoRoot: "/tmp/repo", branch: "tpdc/run-r-1" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.ok).toBe(true);
    expect(result.runId).toBe("12345");
    expect(result.logs).toContain("assertion failed");
    expect(execFileMock).toHaveBeenCalledTimes(2);

    const [bin1, args1] = execFileMock.mock.calls[0]!;
    expect(bin1).toBe("gh");
    expect(args1).toContain("run");
    expect(args1).toContain("list");
    expect(args1).toContain("tpdc/run-r-1");

    const [bin2, args2] = execFileMock.mock.calls[1]!;
    expect(bin2).toBe("gh");
    expect(args2).toEqual(["run", "view", "12345", "--log-failed"]);
  });

  it("returns ok=true with empty logs when no recent run exists", async () => {
    const execFileMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "[]\n", stderr: "" });

    const result = await fetchCILogs(
      { repoRoot: "/tmp/repo", branch: "tpdc/run-r-1" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.ok).toBe(true);
    expect(result.logs).toBe("");
    expect(result.errorMessage).toMatch(/no recent run/i);
    // Only one call (skipped --log-failed)
    expect(execFileMock).toHaveBeenCalledOnce();
  });

  it("returns ok=false when gh run list errors", async () => {
    const execFileMock = vi.fn().mockRejectedValueOnce({
      message: "spawn gh ENOENT",
    });

    const result = await fetchCILogs(
      { repoRoot: "/tmp/repo", branch: "tpdc/run-r-1" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/gh run list failed/i);
  });

  it("returns ok=false when gh run view --log-failed errors", async () => {
    const execFileMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '[{"databaseId": 99}]\n', stderr: "" })
      .mockRejectedValueOnce({ message: "auth required" });

    const result = await fetchCILogs(
      { repoRoot: "/tmp/repo", branch: "tpdc/run-r-1" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.ok).toBe(false);
    expect(result.runId).toBe("99");
    expect(result.errorMessage).toMatch(/log-failed failed/i);
  });

  it("truncates logs longer than maxLogChars (tail-preserved)", async () => {
    const longLog = "a".repeat(10_000) + "\nFINAL FAILURE LINE\n";
    const execFileMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '[{"databaseId": 1}]', stderr: "" })
      .mockResolvedValueOnce({ stdout: longLog, stderr: "" });

    const result = await fetchCILogs(
      { repoRoot: "/tmp/repo", branch: "tpdc/run-r-1", maxLogChars: 500 },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.ok).toBe(true);
    expect(result.logs.length).toBeLessThan(longLog.length);
    expect(result.logs).toContain("truncated");
    expect(result.logs).toContain("FINAL FAILURE LINE"); // tail preserved
  });
});
