import { describe, expect, it, vi } from "vitest";
import { detectBaseBranch } from "./detect-base-branch.js";

describe("detectBaseBranch", () => {
  it("returns the branch from git symbolic-ref when available", async () => {
    const execFileMock = vi.fn().mockResolvedValueOnce({
      stdout: "origin/develop\n",
      stderr: "",
    });

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result).toEqual({ branch: "develop", source: "git" });
    expect(execFileMock).toHaveBeenCalledOnce();
    const [bin, args] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("git");
    expect(args).toContain("symbolic-ref");
    expect(args).toContain("refs/remotes/origin/HEAD");
  });

  it("falls through to gh when git symbolic-ref fails", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce({ message: "no symbolic-ref" })
      .mockResolvedValueOnce({ stdout: "master\n", stderr: "" });

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result).toEqual({ branch: "master", source: "gh" });
    expect(execFileMock).toHaveBeenCalledTimes(2);
    const [bin, args] = execFileMock.mock.calls[1]!;
    expect(bin).toBe("gh");
    expect(args).toContain("repo");
    expect(args).toContain("view");
    expect(args).toContain("--json");
  });

  it("falls back to 'main' when both git and gh fail", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce({ message: "git error" })
      .mockRejectedValueOnce({ message: "gh error" });

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result).toEqual({ branch: "main", source: "fallback" });
  });

  it("respects custom fallback when both fail", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce({})
      .mockRejectedValueOnce({});

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo", fallback: "trunk" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result).toEqual({ branch: "trunk", source: "fallback" });
  });

  it("trims whitespace from output", async () => {
    const execFileMock = vi.fn().mockResolvedValueOnce({
      stdout: "  origin/main  \n\n",
      stderr: "",
    });

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.branch).toBe("main");
  });

  it("falls through to gh if git output doesn't match origin/<branch> shape", async () => {
    const execFileMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "weird-output", stderr: "" })
      .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result).toEqual({ branch: "main", source: "gh" });
  });

  it("falls through to fallback if gh returns empty stdout", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce({})
      .mockResolvedValueOnce({ stdout: "  \n", stderr: "" });

    const result = await detectBaseBranch(
      { repoRoot: "/tmp/repo" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.source).toBe("fallback");
  });
});
