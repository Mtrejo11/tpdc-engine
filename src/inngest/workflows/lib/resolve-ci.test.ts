/**
 * Tests for resolve-ci auto-fix loop over CI failures.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecuteResult } from "../../../stages/execute/execute.schema.js";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../../stages/plan/plan.schema.js";
import type { PushResult } from "../../../stages/push/push.schema.js";

vi.mock("../../../stages/execute/execute.js", () => ({
  runExecute: vi.fn(),
}));
vi.mock("../../../stages/push/push.js", () => ({
  runPush: vi.fn(),
}));
vi.mock("../../../stages/run-tests/fetch-ci-logs.js", () => ({
  fetchCILogs: vi.fn(),
}));

import { runExecute } from "../../../stages/execute/execute.js";
import { runPush } from "../../../stages/push/push.js";
import { fetchCILogs } from "../../../stages/run-tests/fetch-ci-logs.js";
import { resolveCIWithAutoFix } from "./resolve-ci.js";

const intake: IntakeArtifact = {
  title: "T",
  problemStatement: "P",
  affectedUsers: "U",
  observableSymptom: "S",
  acceptanceCriteria: ["AC"],
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

function makePush(overrides: Partial<PushResult> = {}): PushResult {
  return {
    runId: "r-1",
    status: "pushed",
    branch: "tpdc/run-r-1",
    remote: "origin",
    stdout: "",
    stderr: "",
    exitCode: 0,
    worktreeRemoved: true,
    durationMs: 100,
    ...overrides,
  };
}

const fakeStep = {
  run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  // waitForEvent is queued: each call shifts off the front
  waitForEvent: vi.fn(),
};

const baseOpts = {
  step: fakeStep,
  runId: "r-1",
  intake,
  plan,
  repoRoot: "/tmp/repo",
  initialExecute: makeExecute(),
  initialPush: makePush(),
};

describe("resolveCIWithAutoFix", () => {
  beforeEach(() => {
    vi.mocked(runExecute).mockReset();
    vi.mocked(runPush).mockReset();
    vi.mocked(fetchCILogs).mockReset();
    fakeStep.run.mockClear();
    fakeStep.waitForEvent.mockReset();
  });

  it("returns passed when CI succeeds on first wait", async () => {
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        runId: "r-1",
        prNumber: 1,
        status: "success",
        failedJobs: [],
      },
    });

    const result = await resolveCIWithAutoFix(baseOpts);

    expect(result.kind).toBe("passed");
    if (result.kind === "passed") {
      expect(result.attempts).toBe(1);
    }
    expect(runExecute).not.toHaveBeenCalled();
    expect(runPush).not.toHaveBeenCalled();
  });

  it("halts when waitForEvent times out", async () => {
    fakeStep.waitForEvent.mockResolvedValueOnce(null);

    const result = await resolveCIWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/did not complete within/i);
    }
    expect(runExecute).not.toHaveBeenCalled();
  });

  it("halts on cancelled status without retrying", async () => {
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: { runId: "r-1", prNumber: 1, status: "cancelled", failedJobs: [] },
    });

    const result = await resolveCIWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/cancelled/i);
    }
    expect(runExecute).not.toHaveBeenCalled();
  });

  it("retries with fix-mode + force-push when CI fails, succeeds on retry", async () => {
    fakeStep.waitForEvent
      .mockResolvedValueOnce({
        data: { runId: "r-1", prNumber: 1, status: "failure", failedJobs: [] },
      })
      .mockResolvedValueOnce({
        data: { runId: "r-1", prNumber: 1, status: "success", failedJobs: [] },
      });

    vi.mocked(fetchCILogs).mockResolvedValueOnce({
      ok: true,
      runId: "999",
      logs: "test failed: assertion x",
    });

    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({
        commitSha: "fix-sha",
        filesChanged: ["src/x.ts", "src/y.ts"],
      }),
    );
    vi.mocked(runPush).mockResolvedValueOnce(makePush({ status: "pushed" }));

    const result = await resolveCIWithAutoFix(baseOpts);

    expect(result.kind).toBe("passed");
    if (result.kind === "passed") {
      expect(result.attempts).toBe(2);
    }

    // Verify fix-mode call had the CI logs in failureContext
    const fixCall = vi.mocked(runExecute).mock.calls[0]?.[0];
    expect(fixCall?.failureContext?.previousCommands[0]?.stdout).toContain("assertion x");

    // Verify push was force=true
    const pushCall = vi.mocked(runPush).mock.calls[0]?.[0];
    expect(pushCall?.force).toBe(true);
  });

  it("halts after maxRetries when CI keeps failing", async () => {
    const failure = {
      data: { runId: "r-1", prNumber: 1, status: "failure" as const, failedJobs: [] },
    };
    fakeStep.waitForEvent
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure);

    vi.mocked(fetchCILogs).mockResolvedValue({ ok: true, logs: "fail" });
    vi.mocked(runExecute).mockResolvedValue(
      makeExecute({ commitSha: "x", filesChanged: ["a", "b"] }),
    );
    vi.mocked(runPush).mockResolvedValue(makePush());

    const result = await resolveCIWithAutoFix({ ...baseOpts, maxRetries: 2 });

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/still failing after 2/i);
      expect(result.attempts).toBe(3); // initial + 2 retries
    }
    expect(fakeStep.waitForEvent).toHaveBeenCalledTimes(3);
  });

  it("halts when fix execute produces no new changes", async () => {
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: { runId: "r-1", prNumber: 1, status: "failure", failedJobs: [] },
    });
    vi.mocked(fetchCILogs).mockResolvedValueOnce({ ok: true, logs: "fail" });
    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({ commitSha: undefined, filesChanged: ["src/x.ts"] }),
    );

    const result = await resolveCIWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/no new changes|stuck/i);
    }
    expect(runPush).not.toHaveBeenCalled();
  });

  it("halts when fix push fails", async () => {
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: { runId: "r-1", prNumber: 1, status: "failure", failedJobs: [] },
    });
    vi.mocked(fetchCILogs).mockResolvedValueOnce({ ok: true, logs: "fail" });
    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({ commitSha: "x", filesChanged: ["a", "b"] }),
    );
    vi.mocked(runPush).mockResolvedValueOnce(
      makePush({
        status: "failed",
        stderr: "auth error",
        exitCode: 128,
      }),
    );

    const result = await resolveCIWithAutoFix(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/push failed/i);
    }
  });

  it("uses configured ciTimeout in waitForEvent", async () => {
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: { runId: "r-1", prNumber: 1, status: "success", failedJobs: [] },
    });

    await resolveCIWithAutoFix({ ...baseOpts, ciTimeout: "2h" });

    const [, opts] = fakeStep.waitForEvent.mock.calls[0]!;
    expect(opts.timeout).toBe("2h");
    expect(opts.event).toBe("tpdc/ci.completed");
    expect(opts.if).toContain("r-1");
  });

  it("each waitForEvent / fix attempt uses distinct step ids", async () => {
    fakeStep.waitForEvent
      .mockResolvedValueOnce({
        data: { runId: "r-1", prNumber: 1, status: "failure", failedJobs: [] },
      })
      .mockResolvedValueOnce({
        data: { runId: "r-1", prNumber: 1, status: "success", failedJobs: [] },
      });

    vi.mocked(fetchCILogs).mockResolvedValueOnce({ ok: true, logs: "f" });
    vi.mocked(runExecute).mockResolvedValueOnce(
      makeExecute({ commitSha: "x", filesChanged: ["a", "b"] }),
    );
    vi.mocked(runPush).mockResolvedValueOnce(makePush());

    await resolveCIWithAutoFix(baseOpts);

    const waitIds = fakeStep.waitForEvent.mock.calls.map((c) => c[0]);
    expect(waitIds).toEqual(["wait-ci-attempt-0", "wait-ci-attempt-1"]);

    const stepIds = fakeStep.run.mock.calls.map((c) => c[0]);
    expect(stepIds).toContain("fetch-ci-logs-attempt-1");
    expect(stepIds).toContain("execute-fix-ci-attempt-1");
    expect(stepIds).toContain("push-fix-ci-attempt-1");
  });
});
