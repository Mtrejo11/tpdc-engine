/**
 * Tests for resolve-tests auto-fix loop.
 *
 * Mocks Inngest's step.run by invoking the closure directly. Mocks runTests
 * and runExecute via vi.mock so we can drive the loop deterministically.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecuteResult } from "../../../stages/execute/execute.schema.js";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../../stages/plan/plan.schema.js";
import type { RunTestsResult } from "../../../stages/run-tests/run-tests.schema.js";

// Mocks must be hoisted; vi.mock is hoisted by vitest.
vi.mock("../../../stages/run-tests/run-tests.js", () => ({
  runTests: vi.fn(),
}));
vi.mock("../../../stages/execute/execute.js", () => ({
  runExecute: vi.fn(),
}));

import { runExecute } from "../../../stages/execute/execute.js";
import { runTests } from "../../../stages/run-tests/run-tests.js";
import { resolveTestsWithAutoFix } from "./resolve-tests.js";

const intake: IntakeArtifact = {
  title: "Test feature",
  problemStatement: "P",
  affectedUsers: "U",
  observableSymptom: "S",
  acceptanceCriteria: ["AC1"],
  outOfScope: [],
  assumptions: [],
  openQuestions: [],
  readiness: "ready",
};

const plan: PlanArtifact = {
  title: "P",
  objective: "O",
  steps: [
    {
      stepNumber: 1,
      title: "S1",
      description: "D",
      acceptanceCriteria: ["AC1"],
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

function makeExecute(overrides: Partial<ExecuteResult> = {}): ExecuteResult {
  return {
    runId: "r-1",
    status: "completed",
    worktreePath: "/tmp/wt",
    branch: "tpdc/run-r-1",
    baseSha: "abc",
    commitSha: "deadbeef",
    commitMessage: "msg",
    filesChanged: ["src/x.ts"],
    diff: "...",
    finalSummary: "did the thing",
    toolCallCount: 5,
    turnCount: 3,
    usage: { inputTokens: 1000, outputTokens: 500 },
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

function makeTests(overrides: Partial<RunTestsResult> = {}): RunTestsResult {
  return {
    runId: "r-1",
    status: "all_passed",
    results: [],
    totalDurationMs: 100,
    summary: { total: 1, passed: 1, failed: 0, errored: 0 },
    ...overrides,
  };
}

// Mock step.run by simply invoking the closure
const fakeStep = {
  run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
};

const baseOpts = {
  step: fakeStep,
  runId: "r-1",
  intake,
  plan,
  repoRoot: "/tmp/repo",
  initialExecute: makeExecute(),
};

describe("resolveTestsWithAutoFix", () => {
  beforeEach(() => {
    vi.mocked(runTests).mockReset();
    vi.mocked(runExecute).mockReset();
    fakeStep.run.mockClear();
  });

  it("returns passed when first test run passes", async () => {
    vi.mocked(runTests).mockResolvedValueOnce(makeTests({ status: "all_passed" }));

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("passed");
    if (result.kind === "passed") {
      expect(result.attempts).toBe(1);
    }
    expect(runExecute).not.toHaveBeenCalled();
  });

  it("retries with fix-mode execute when tests fail, succeeds on retry", async () => {
    vi.mocked(runTests)
      .mockResolvedValueOnce(
        makeTests({
          status: "some_failed",
          results: [
            {
              command: "npm test",
              status: "failed",
              exitCode: 1,
              stdout: "1 of 2 failed",
              stderr: "",
              durationMs: 200,
            },
          ],
          summary: { total: 1, passed: 0, failed: 1, errored: 0 },
        }),
      )
      .mockResolvedValueOnce(makeTests({ status: "all_passed" }));

    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({
        commitSha: "newcommit",
        filesChanged: ["src/x.ts", "src/y.ts"],
      }),
    );

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("passed");
    if (result.kind === "passed") {
      expect(result.attempts).toBe(2);
    }
    expect(runExecute).toHaveBeenCalledOnce();

    // Verify the failure context was passed correctly
    const fixCall = vi.mocked(runExecute).mock.calls[0]?.[0];
    expect(fixCall?.failureContext).toBeDefined();
    expect(fixCall?.failureContext?.attempt).toBe(1);
    expect(fixCall?.failureContext?.previousCommands).toHaveLength(1);
    expect(fixCall?.failureContext?.previousCommands[0]?.command).toBe("npm test");
    expect(fixCall?.existingWorktree).toBeDefined();
    expect(fixCall?.existingWorktree?.path).toBe("/tmp/wt");
  });

  it("halts after maxRetries when tests keep failing", async () => {
    const failingTests = makeTests({
      status: "some_failed",
      results: [
        {
          command: "npm test",
          status: "failed",
          exitCode: 1,
          stdout: "still failing",
          stderr: "",
          durationMs: 100,
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, errored: 0 },
    });

    vi.mocked(runTests).mockResolvedValue(failingTests);
    vi.mocked(runExecute).mockResolvedValue(
      makeExecute({
        commitSha: "fix-commit",
        filesChanged: ["src/x.ts", "src/y.ts"],
      }),
    );

    const result = await resolveTestsWithAutoFix({
      ...baseOpts,
      maxRetries: 2,
    });

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/still failing after 2 fix attempt/i);
      expect(result.attempts).toBe(3); // initial + 2 retries
    }
    // 3 test runs (initial + 2 retries) and 2 fix executes
    expect(runTests).toHaveBeenCalledTimes(3);
    expect(runExecute).toHaveBeenCalledTimes(2);
  });

  it("does not retry on no_commands status", async () => {
    vi.mocked(runTests).mockResolvedValueOnce(makeTests({ status: "no_commands" }));

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/no testCommands/i);
    }
    expect(runExecute).not.toHaveBeenCalled();
  });

  it("does not retry on errored status (infra issue)", async () => {
    vi.mocked(runTests).mockResolvedValueOnce(
      makeTests({
        status: "errored",
        summary: { total: 1, passed: 0, failed: 0, errored: 1 },
      }),
    );

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/errored/i);
    }
    expect(runExecute).not.toHaveBeenCalled();
  });

  it("halts when fix attempt produces no new changes (agent stuck)", async () => {
    vi.mocked(runTests).mockResolvedValue(
      makeTests({
        status: "some_failed",
        results: [
          {
            command: "npm test",
            status: "failed",
            exitCode: 1,
            stdout: "fail",
            stderr: "",
            durationMs: 100,
          },
        ],
        summary: { total: 1, passed: 0, failed: 1, errored: 0 },
      }),
    );

    // Fix execute returns the same files + no new commit (no progress)
    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({
        commitSha: undefined,
        filesChanged: ["src/x.ts"],
      }),
    );

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/no new changes|agent appears stuck/i);
    }
    expect(runExecute).toHaveBeenCalledOnce();
  });

  it("halts when fix attempt returns non-completed status", async () => {
    vi.mocked(runTests).mockResolvedValue(
      makeTests({
        status: "some_failed",
        results: [
          {
            command: "npm test",
            status: "failed",
            exitCode: 1,
            stdout: "fail",
            stderr: "",
            durationMs: 100,
          },
        ],
        summary: { total: 1, passed: 0, failed: 1, errored: 0 },
      }),
    );

    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({ status: "max_turns_exceeded" }),
    );

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/max_turns_exceeded/i);
    }
  });

  it("aggregates token usage across initial + retries", async () => {
    vi.mocked(runTests)
      .mockResolvedValueOnce(
        makeTests({
          status: "some_failed",
          results: [
            {
              command: "npm test",
              status: "failed",
              exitCode: 1,
              stdout: "fail",
              stderr: "",
              durationMs: 100,
            },
          ],
          summary: { total: 1, passed: 0, failed: 1, errored: 0 },
        }),
      )
      .mockResolvedValueOnce(makeTests({ status: "all_passed" }));

    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({
        usage: { inputTokens: 7000, outputTokens: 500 },
        commitSha: "fix",
        filesChanged: ["a", "b"],
      }),
    );

    const result = await resolveTestsWithAutoFix(baseOpts);

    expect(result.kind).toBe("passed");
    if (result.kind === "passed") {
      // initial = 1000 + 500, retry = 7000 + 500
      expect(result.totalUsage.inputTokens).toBe(8000);
      expect(result.totalUsage.outputTokens).toBe(1000);
    }
  });

  it("each retry attempt is its own step.run for Inngest visibility", async () => {
    vi.mocked(runTests)
      .mockResolvedValueOnce(
        makeTests({
          status: "some_failed",
          results: [
            {
              command: "npm test",
              status: "failed",
              exitCode: 1,
              stdout: "fail",
              stderr: "",
              durationMs: 100,
            },
          ],
          summary: { total: 1, passed: 0, failed: 1, errored: 0 },
        }),
      )
      .mockResolvedValueOnce(makeTests({ status: "all_passed" }));

    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({ commitSha: "x", filesChanged: ["a", "b"] }),
    );

    await resolveTestsWithAutoFix(baseOpts);

    const stepIds = fakeStep.run.mock.calls.map((c) => c[0]);
    expect(stepIds).toContain("run-tests-attempt-0");
    expect(stepIds).toContain("execute-fix-attempt-1");
    expect(stepIds).toContain("run-tests-attempt-1");
  });
});
