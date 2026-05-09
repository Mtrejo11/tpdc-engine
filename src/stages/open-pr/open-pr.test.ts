import { describe, expect, it, vi } from "vitest";
import type { ExecuteResult } from "../execute/execute.schema.js";
import type { IntakeArtifact } from "../intake/intake.schema.js";
import type { PlanArtifact } from "../plan/plan.schema.js";
import type { RunTestsResult } from "../run-tests/run-tests.schema.js";
import { runOpenPR } from "./open-pr.js";

const intake: IntakeArtifact = {
  title: "Add password reset flow",
  problemStatement: "Users can't reset passwords.",
  affectedUsers: "End users",
  observableSymptom: "No flow exists.",
  acceptanceCriteria: ["Reset link sent"],
  outOfScope: [],
  assumptions: [],
  openQuestions: [],
  readiness: "ready",
};

const plan: PlanArtifact = {
  title: "Reset flow",
  objective: "Self-service reset.",
  steps: [
    {
      stepNumber: 1,
      title: "Add endpoint",
      description: "POST /reset",
      acceptanceCriteria: ["200 returned"],
      dependencies: [],
      expectedFiles: [],
    },
  ],
  riskLevel: "low",
  validationApproach: "npm test",
  testCommands: ["npm test"],
  assumptions: [],
  blockers: [],
  readiness: "ready",
};

const execute: ExecuteResult = {
  runId: "r-1",
  status: "completed",
  worktreePath: "/tmp/wt",
  branch: "tpdc/run-r-1",
  baseSha: "abc",
  filesChanged: ["src/reset.ts"],
  diff: "...",
  finalSummary: "done",
  toolCallCount: 5,
  turnCount: 3,
  usage: { inputTokens: 1000, outputTokens: 500 },
  model: "claude-sonnet-4-6",
};

const tests: RunTestsResult = {
  runId: "r-1",
  status: "all_passed",
  results: [
    {
      command: "npm test",
      status: "passed",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
    },
  ],
  totalDurationMs: 100,
  summary: { total: 1, passed: 1, failed: 0, errored: 0 },
};

const baseReq = {
  runId: "r-1",
  repoRoot: "/tmp/repo",
  branch: "tpdc/run-r-1",
  intake,
  plan,
  execute,
  tests,
};

describe("runOpenPR", () => {
  it("returns opened with parsed prUrl and prNumber on gh success", async () => {
    const execFileMock = vi.fn().mockResolvedValue({
      stdout: "https://github.com/acme/app/pull/42\n",
      stderr: "",
    });

    const result = await runOpenPR(
      baseReq,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.status).toBe("opened");
    expect(result.prUrl).toBe("https://github.com/acme/app/pull/42");
    expect(result.prNumber).toBe(42);
    expect(result.exitCode).toBe(0);

    // Confirm gh was called with expected args
    const [bin, args] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("gh");
    expect(args).toContain("pr");
    expect(args).toContain("create");
    expect(args).toContain("--title");
    expect(args).toContain("--body");
    expect(args).toContain("--base");
    expect(args).toContain("main");
    expect(args).toContain("--head");
    expect(args).toContain("tpdc/run-r-1");
  });

  it("uses configured baseBranch when provided", async () => {
    const execFileMock = vi.fn().mockResolvedValue({
      stdout: "https://github.com/acme/app/pull/7\n",
      stderr: "",
    });

    await runOpenPR(
      { ...baseReq, baseBranch: "develop" },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    const [, args] = execFileMock.mock.calls[0]!;
    const baseIdx = args.indexOf("--base");
    expect(args[baseIdx + 1]).toBe("develop");
  });

  it("appends --draft when draft=true", async () => {
    const execFileMock = vi.fn().mockResolvedValue({
      stdout: "https://github.com/acme/app/pull/7\n",
      stderr: "",
    });

    await runOpenPR(
      { ...baseReq, draft: true },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args).toContain("--draft");
  });

  it("returns gh_missing when gh binary is not on PATH (ENOENT)", async () => {
    const execFileMock = vi.fn().mockRejectedValue({
      code: "ENOENT",
      message: "spawn gh ENOENT",
    });

    const result = await runOpenPR(
      baseReq,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.status).toBe("gh_missing");
    expect(result.errorMessage).toMatch(/gh CLI not found/i);
    expect(result.errorMessage).toContain("gh auth login");
  });

  it("returns failed on non-zero exit (e.g., branch protection)", async () => {
    const execFileMock = vi.fn().mockRejectedValue({
      code: 1,
      stdout: "",
      stderr: "could not push: branch protection rule",
      message: "Command failed",
    });

    const result = await runOpenPR(
      baseReq,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("branch protection");
  });

  it("returns errored when gh is killed by signal/timeout", async () => {
    const execFileMock = vi.fn().mockRejectedValue({
      code: null,
      killed: true,
      signal: "SIGTERM",
      message: "Command timed out",
    });

    const result = await runOpenPR(
      baseReq,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.status).toBe("errored");
  });

  it("returns failed when gh exits 0 but no PR URL appears in stdout", async () => {
    const execFileMock = vi.fn().mockResolvedValue({
      stdout: "Done.\n",
      stderr: "",
    });

    const result = await runOpenPR(
      baseReq,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/no PR URL/i);
  });

  it("captures the rendered title and body in the result for audit", async () => {
    const execFileMock = vi.fn().mockResolvedValue({
      stdout: "https://github.com/acme/app/pull/1\n",
      stderr: "",
    });

    const result = await runOpenPR(
      baseReq,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.title).toBe("Add password reset flow");
    expect(result.body).toContain("## Summary");
    expect(result.body).toContain("Add endpoint");
    expect(result.body).toContain("✅"); // passed test icon
  });

  it("renders WIP warning in body when wipReason is provided (TPDC bug #4)", async () => {
    const execFileMock = vi.fn().mockResolvedValue({
      stdout: "https://github.com/acme/app/pull/1\n",
      stderr: "",
    });

    const result = await runOpenPR(
      {
        ...baseReq,
        tests: undefined, // no tests on WIP path
        draft: true,
        wipReason: "agent halted at max_turns (60 turns / 80 tool calls)",
      },
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      { execFileImpl: execFileMock as any },
    );

    expect(result.status).toBe("opened");
    expect(result.body).toContain("Work in progress");
    expect(result.body).toContain("60 turns / 80 tool calls");
    expect(result.body).toContain("Skipped — agent halted");
    // gh was called with --draft
    const args = execFileMock.mock.calls[0]?.[1];
    expect(args).toContain("--draft");
  });
});
