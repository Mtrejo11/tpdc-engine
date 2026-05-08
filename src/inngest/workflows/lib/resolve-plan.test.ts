/**
 * Tests for resolve-plan unblock loop.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../../stages/plan/plan.schema.js";

vi.mock("../../../stages/plan/plan.js", () => ({
  runPlan: vi.fn(),
}));

import { runPlan } from "../../../stages/plan/plan.js";
import { resolvePlanWithUnblock } from "./resolve-plan.js";

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

function makePlan(overrides: Partial<PlanArtifact> = {}): PlanArtifact {
  return {
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
    ...overrides,
  };
}

const fakeStep = {
  run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  sendEvent: vi.fn(
    async (_id: string, _event: { name: string; data: unknown }) => undefined,
  ),
  waitForEvent: vi.fn(
    async (_id: string, _opts: { event: string; timeout: string; if?: string }) =>
      null as null | { data: { runId: string; resolutions: Array<{ blocker: string; resolution: string }> } },
  ),
};

const baseOpts = {
  step: fakeStep,
  runId: "r-1",
  intake,
};

describe("resolvePlanWithUnblock", () => {
  beforeEach(() => {
    vi.mocked(runPlan).mockReset();
    fakeStep.run.mockClear();
    fakeStep.sendEvent.mockClear();
    fakeStep.waitForEvent.mockReset();
  });

  it("returns ready when plan is ready on first attempt", async () => {
    vi.mocked(runPlan).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makePlan({ readiness: "ready" }),
      usage: { inputTokens: 100, outputTokens: 200 },
      model: "claude-sonnet-4-6",
    });

    const result = await resolvePlanWithUnblock(baseOpts);

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.attempts).toBe(1);
    }
    expect(fakeStep.sendEvent).not.toHaveBeenCalled();
    expect(fakeStep.waitForEvent).not.toHaveBeenCalled();
  });

  it("halts on not_ready without retry", async () => {
    vi.mocked(runPlan).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makePlan({ readiness: "not_ready", steps: [] }),
      usage: { inputTokens: 100, outputTokens: 200 },
      model: "claude-sonnet-4-6",
    });

    const result = await resolvePlanWithUnblock(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/not_ready/);
    }
    expect(fakeStep.sendEvent).not.toHaveBeenCalled();
  });

  it("retries with resolutions when plan reports needs_input + blockers, succeeds on retry", async () => {
    vi.mocked(runPlan)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makePlan({
          readiness: "needs_input",
          steps: [],
          blockers: [
            {
              description: "Frontend framework not specified",
              resolution: "Need user to choose React or Vue",
            },
          ],
        }),
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makePlan({ readiness: "ready" }),
        usage: { inputTokens: 150, outputTokens: 250 },
        model: "claude-sonnet-4-6",
      });

    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        runId: "r-1",
        resolutions: [
          {
            blocker: "Frontend framework not specified",
            resolution: "Use React (matches existing convention)",
          },
        ],
      },
    });

    const result = await resolvePlanWithUnblock(baseOpts);

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.attempts).toBe(2);
    }

    // Verify second runPlan call had additionalContext with the resolution
    const secondCall = vi.mocked(runPlan).mock.calls[1]?.[0];
    expect(secondCall?.additionalContext).toContain("Frontend framework not specified");
    expect(secondCall?.additionalContext).toContain("Use React");

    // Verify event flow
    expect(fakeStep.sendEvent).toHaveBeenCalledOnce();
    const sendCall = fakeStep.sendEvent.mock.calls[0]!;
    expect(sendCall[1].name).toBe("tpdc/plan.unblock_requested");
    const sentData = sendCall[1].data as { blockers: unknown[] };
    expect(sentData.blockers).toHaveLength(1);

    expect(fakeStep.waitForEvent).toHaveBeenCalledOnce();
    const waitCall = fakeStep.waitForEvent.mock.calls[0]!;
    expect(waitCall[1].event).toBe("tpdc/plan.unblocked");
    expect(waitCall[1].if).toContain("r-1");
  });

  it("halts after maxAttempts when blockers persist", async () => {
    const blockedPlan = makePlan({
      readiness: "needs_input",
      steps: [],
      blockers: [
        { description: "still blocked", resolution: "need answer" },
      ],
    });
    vi.mocked(runPlan).mockResolvedValue({
      runId: "r-1",
      artifact: blockedPlan,
      usage: { inputTokens: 50, outputTokens: 100 },
      model: "claude-sonnet-4-6",
    });

    fakeStep.waitForEvent.mockResolvedValue({
      data: {
        runId: "r-1",
        resolutions: [{ blocker: "still blocked", resolution: "x" }],
      },
    });

    const result = await resolvePlanWithUnblock({
      ...baseOpts,
      maxAttempts: 2,
    });

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/still has 1 blocker.*after 2 attempt/i);
      expect(result.attempts).toBe(2);
    }
  });

  it("halts on unblock timeout", async () => {
    vi.mocked(runPlan).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makePlan({
        readiness: "needs_input",
        steps: [],
        blockers: [{ description: "missing", resolution: "ask user" }],
      }),
      usage: { inputTokens: 100, outputTokens: 100 },
      model: "claude-sonnet-4-6",
    });

    fakeStep.waitForEvent.mockResolvedValueOnce(null);

    const result = await resolvePlanWithUnblock(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/unblock timeout/i);
    }
  });

  it("treats needs_input with empty blockers as ready", async () => {
    vi.mocked(runPlan).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makePlan({
        readiness: "needs_input",
        blockers: [],
      }),
      usage: { inputTokens: 100, outputTokens: 100 },
      model: "claude-sonnet-4-6",
    });

    const result = await resolvePlanWithUnblock(baseOpts);

    expect(result.kind).toBe("ready");
    expect(fakeStep.sendEvent).not.toHaveBeenCalled();
  });

  it("aggregates token usage across attempts", async () => {
    vi.mocked(runPlan)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makePlan({
          readiness: "needs_input",
          steps: [],
          blockers: [{ description: "x", resolution: "y" }],
        }),
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makePlan({ readiness: "ready" }),
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-sonnet-4-6",
      });

    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        runId: "r-1",
        resolutions: [{ blocker: "x", resolution: "z" }],
      },
    });

    const result = await resolvePlanWithUnblock(baseOpts);

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.totalUsage).toEqual({ inputTokens: 150, outputTokens: 300 });
    }
  });
});
