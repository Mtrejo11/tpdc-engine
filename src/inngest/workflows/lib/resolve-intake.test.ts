/**
 * Tests for resolve-intake unblock loop.
 *
 * Coverage focus (alpha.3): the maxAttempts override path. The new default
 * (5, up from 3) and the per-event configurability via FeatureRequested are
 * defense-in-depth before the team-of-agents lands (see DECISIONS.md §D6).
 * These tests pin the contract so the override actually takes effect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";

vi.mock("../../../stages/intake/intake.js", () => ({
  runIntake: vi.fn(),
}));

import { runIntake } from "../../../stages/intake/intake.js";
import { resolveIntakeWithUnblock } from "./resolve-intake.js";

function makeIntake(overrides: Partial<IntakeArtifact> = {}): IntakeArtifact {
  return {
    title: "T",
    problemStatement: "P",
    affectedUsers: "U",
    observableSymptom: "S",
    acceptanceCriteria: ["AC"],
    outOfScope: [],
    assumptions: [],
    openQuestions: [],
    readiness: "ready",
    ...overrides,
  };
}

function makeBlockingIntake(): IntakeArtifact {
  return makeIntake({
    readiness: "needs_input",
    openQuestions: [
      { question: "still ambiguous?", owner: "user", blocking: true },
    ],
  });
}

const fakeStep = {
  run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  sendEvent: vi.fn(
    async (_id: string, _event: { name: string; data: unknown }) => undefined,
  ),
  waitForEvent: vi.fn(
    async (
      _id: string,
      _opts: { event: string; timeout: string; if?: string },
    ) =>
      null as
        | null
        | { data: { runId: string; answers: Array<{ question: string; answer: string }> } },
  ),
};

const baseOpts = {
  step: fakeStep,
  runId: "r-1",
  request: "Mejorar la UI",
};

describe("resolveIntakeWithUnblock", () => {
  beforeEach(() => {
    vi.mocked(runIntake).mockReset();
    fakeStep.run.mockClear();
    fakeStep.sendEvent.mockClear();
    fakeStep.waitForEvent.mockReset();
  });

  it("returns ready when intake is ready on first attempt", async () => {
    vi.mocked(runIntake).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makeIntake({ readiness: "ready" }),
      usage: { inputTokens: 100, outputTokens: 200 },
      model: "claude-sonnet-4-6",
    });

    const result = await resolveIntakeWithUnblock(baseOpts);

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.attempts).toBe(1);
    }
    expect(fakeStep.sendEvent).not.toHaveBeenCalled();
    expect(fakeStep.waitForEvent).not.toHaveBeenCalled();
  });

  it("uses the new default of 5 max attempts when no override is provided", async () => {
    // Mock intake to keep returning blocking questions forever.
    vi.mocked(runIntake).mockResolvedValue({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    // Always supply a non-empty answer so the loop never times out.
    fakeStep.waitForEvent.mockResolvedValue({
      data: {
        runId: "r-1",
        answers: [{ question: "still ambiguous?", answer: "use defaults" }],
      },
    });

    const result = await resolveIntakeWithUnblock(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/after 5 attempt/);
      expect(result.attempts).toBe(5);
    }
    expect(vi.mocked(runIntake)).toHaveBeenCalledTimes(5);
    // Between the 5 attempts there are 4 unblock rounds (last attempt halts).
    expect(fakeStep.waitForEvent).toHaveBeenCalledTimes(4);
  });

  it("respects maxAttempts override (smaller than default)", async () => {
    vi.mocked(runIntake).mockResolvedValue({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    fakeStep.waitForEvent.mockResolvedValue({
      data: {
        runId: "r-1",
        answers: [{ question: "still ambiguous?", answer: "x" }],
      },
    });

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      maxAttempts: 2,
    });

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/after 2 attempt/);
      expect(result.attempts).toBe(2);
    }
    expect(vi.mocked(runIntake)).toHaveBeenCalledTimes(2);
  });

  it("respects maxAttempts override (larger than default)", async () => {
    vi.mocked(runIntake).mockResolvedValue({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    fakeStep.waitForEvent.mockResolvedValue({
      data: {
        runId: "r-1",
        answers: [{ question: "still ambiguous?", answer: "x" }],
      },
    });

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      maxAttempts: 7,
    });

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/after 7 attempt/);
      expect(result.attempts).toBe(7);
    }
    expect(vi.mocked(runIntake)).toHaveBeenCalledTimes(7);
  });

  it("halts on unblock timeout", async () => {
    vi.mocked(runIntake).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    fakeStep.waitForEvent.mockResolvedValueOnce(null);

    const result = await resolveIntakeWithUnblock(baseOpts);

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/unblock timeout/);
    }
  });

  it("succeeds on retry after augmenting with answers", async () => {
    vi.mocked(runIntake)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeIntake({ readiness: "ready" }),
        usage: { inputTokens: 150, outputTokens: 250 },
        model: "claude-sonnet-4-6",
      });

    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: {
        runId: "r-1",
        answers: [{ question: "still ambiguous?", answer: "use defaults" }],
      },
    });

    const result = await resolveIntakeWithUnblock(baseOpts);

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.attempts).toBe(2);
      expect(result.totalUsage).toEqual({ inputTokens: 250, outputTokens: 450 });
    }

    // Second call sees the augmented request (original + Q&A)
    const secondCall = vi.mocked(runIntake).mock.calls[1]?.[0];
    expect(secondCall?.request).toContain("Mejorar la UI");
    expect(secondCall?.request).toContain("use defaults");
  });
});
