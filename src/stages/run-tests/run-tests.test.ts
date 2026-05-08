import { describe, expect, it, vi } from "vitest";
import { runTests } from "./run-tests.js";

describe("runTests", () => {
  it("returns no_commands when commands array is empty", async () => {
    const result = await runTests({
      runId: "t1",
      worktreePath: "/tmp/wt",
      commands: [],
    });
    expect(result.status).toBe("no_commands");
    expect(result.results).toEqual([]);
    expect(result.summary).toEqual({ total: 0, passed: 0, failed: 0, errored: 0 });
  });

  it("returns all_passed when every command exits 0", async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "ok 1\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "ok 2\n", stderr: "" });

    const result = await runTests(
      {
        runId: "t2",
        worktreePath: "/tmp/wt",
        commands: ["npm test", "npm run lint"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execImpl: execMock as any },
    );

    expect(result.status).toBe("all_passed");
    expect(result.summary).toEqual({ total: 2, passed: 2, failed: 0, errored: 0 });
    expect(result.results[0]?.command).toBe("npm test");
    expect(result.results[0]?.exitCode).toBe(0);
    expect(result.results[1]?.command).toBe("npm run lint");
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("returns some_failed when at least one command exits non-zero", async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "ok\n", stderr: "" })
      .mockRejectedValueOnce({
        code: 1,
        stdout: "1 of 5 tests failed\n",
        stderr: "",
      });

    const result = await runTests(
      {
        runId: "t3",
        worktreePath: "/tmp/wt",
        commands: ["npm run lint", "npm test"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execImpl: execMock as any },
    );

    expect(result.status).toBe("some_failed");
    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1, errored: 0 });
    expect(result.results[1]?.status).toBe("failed");
    expect(result.results[1]?.exitCode).toBe(1);
    expect(result.results[1]?.stdout).toContain("1 of 5 tests failed");
  });

  it("returns errored when a command is killed by signal (timeout)", async () => {
    const execMock = vi.fn().mockRejectedValue({
      code: null,
      killed: true,
      signal: "SIGTERM",
      stdout: "",
      stderr: "Killed",
      message: "Command timed out",
    });

    const result = await runTests(
      {
        runId: "t4",
        worktreePath: "/tmp/wt",
        commands: ["sleep 100"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execImpl: execMock as any },
    );

    expect(result.status).toBe("errored");
    expect(result.summary.errored).toBe(1);
    expect(result.results[0]?.signal).toBe("SIGTERM");
    expect(result.results[0]?.errorMessage).toBeDefined();
  });

  it("blocks deny-pattern commands without executing", async () => {
    const execMock = vi.fn();

    const result = await runTests(
      {
        runId: "t5",
        worktreePath: "/tmp/wt",
        commands: ["rm -rf node_modules", "npm test"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execImpl: execMock as any },
    );

    expect(result.status).toBe("errored"); // because at least one errored (the rm)
    expect(result.results[0]?.status).toBe("errored");
    expect(result.results[0]?.errorMessage).toMatch(/deny pattern/i);
    // The npm test still gets attempted (we don't short-circuit on first deny)
    expect(execMock).toHaveBeenCalledOnce();
    expect(execMock).toHaveBeenCalledWith("npm test", expect.any(Object));
  });

  it("preserves command order in results", async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "a", stderr: "" })
      .mockResolvedValueOnce({ stdout: "b", stderr: "" })
      .mockResolvedValueOnce({ stdout: "c", stderr: "" });

    const result = await runTests(
      {
        runId: "t6",
        worktreePath: "/tmp/wt",
        commands: ["echo a", "echo b", "echo c"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execImpl: execMock as any },
    );

    expect(result.results.map((r) => r.command)).toEqual([
      "echo a",
      "echo b",
      "echo c",
    ]);
  });

  it("totalDurationMs sums per-command durations approximately", async () => {
    const execMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { stdout: "", stderr: "" };
    });

    const result = await runTests(
      {
        runId: "t7",
        worktreePath: "/tmp/wt",
        commands: ["echo 1", "echo 2"],
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execImpl: execMock as any },
    );

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(10);
    expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(5);
  });
});
