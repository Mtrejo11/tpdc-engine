import { describe, expect, it, vi } from "vitest";
import { runPush } from "./push.js";

describe("runPush", () => {
  it("returns pushed and cleans up worktree on successful git push", async () => {
    const execFileMock = vi.fn().mockResolvedValue({ stdout: "Branch pushed.\n", stderr: "" });
    const removeWorktreeMock = vi.fn().mockResolvedValue(undefined);

    const result = await runPush(
      {
        runId: "p1",
        repoRoot: "/tmp/repo",
        worktreePath: "/tmp/repo/.tpdc/worktrees/p1",
        branch: "tpdc/run-p1",
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mocks
      { execFileImpl: execFileMock as any, removeWorktreeImpl: removeWorktreeMock as any },
    );

    expect(result.status).toBe("pushed");
    expect(result.worktreeRemoved).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(execFileMock).toHaveBeenCalledOnce();
    const [bin, args] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("git");
    expect(args).toEqual(["push", "-u", "origin", "tpdc/run-p1"]);

    // removeWorktree should be called with deleteBranch: false
    expect(removeWorktreeMock).toHaveBeenCalledOnce();
    const [, , opts] = removeWorktreeMock.mock.calls[0]!;
    expect(opts).toEqual({ deleteBranch: false });
  });

  it("returns failed and does NOT cleanup on non-zero exit", async () => {
    const execFileMock = vi.fn().mockRejectedValue({
      code: 128,
      stdout: "",
      stderr: "error: failed to push some refs to remote",
      message: "Command failed",
    });
    const removeWorktreeMock = vi.fn();

    const result = await runPush(
      {
        runId: "p2",
        repoRoot: "/tmp/repo",
        worktreePath: "/tmp/repo/.tpdc/worktrees/p2",
        branch: "tpdc/run-p2",
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mocks
      { execFileImpl: execFileMock as any, removeWorktreeImpl: removeWorktreeMock as any },
    );

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain("failed to push");
    expect(result.worktreeRemoved).toBe(false);
    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });

  it("returns errored when git push is killed by signal/timeout", async () => {
    const execFileMock = vi.fn().mockRejectedValue({
      code: null,
      killed: true,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      message: "Command timed out",
    });

    const result = await runPush(
      {
        runId: "p3",
        repoRoot: "/tmp/repo",
        worktreePath: "/tmp/repo/.tpdc/worktrees/p3",
        branch: "tpdc/run-p3",
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mocks
      { execFileImpl: execFileMock as any, removeWorktreeImpl: vi.fn() as any },
    );

    expect(result.status).toBe("errored");
    expect(result.errorMessage).toMatch(/timed out/i);
    expect(result.exitCode).toBe(-1);
  });

  it("uses --force-with-lease when force=true", async () => {
    const execFileMock = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await runPush(
      {
        runId: "p4",
        repoRoot: "/tmp/repo",
        worktreePath: "/tmp/repo/.tpdc/worktrees/p4",
        branch: "tpdc/run-p4",
        force: true,
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mocks
      { execFileImpl: execFileMock as any, removeWorktreeImpl: vi.fn().mockResolvedValue(undefined) as any },
    );

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args).toContain("--force-with-lease");
  });

  it("uses configured remote when provided", async () => {
    const execFileMock = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await runPush(
      {
        runId: "p5",
        repoRoot: "/tmp/repo",
        worktreePath: "/tmp/repo/.tpdc/worktrees/p5",
        branch: "tpdc/run-p5",
        remote: "upstream",
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mocks
      { execFileImpl: execFileMock as any, removeWorktreeImpl: vi.fn().mockResolvedValue(undefined) as any },
    );

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args).toEqual(["push", "-u", "upstream", "tpdc/run-p5"]);
  });

  it("soft-fails worktree cleanup but still reports pushed", async () => {
    const execFileMock = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const removeWorktreeMock = vi.fn().mockRejectedValue(new Error("filesystem busy"));

    const result = await runPush(
      {
        runId: "p6",
        repoRoot: "/tmp/repo",
        worktreePath: "/tmp/repo/.tpdc/worktrees/p6",
        branch: "tpdc/run-p6",
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mocks
      { execFileImpl: execFileMock as any, removeWorktreeImpl: removeWorktreeMock as any },
    );

    expect(result.status).toBe("pushed");
    expect(result.worktreeRemoved).toBe(false);
  });
});
