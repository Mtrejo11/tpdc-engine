/**
 * Tests for resolve-intake unblock loop.
 *
 * Coverage focus (alpha.3):
 *   - maxAttempts default + override (rc1)
 *   - Team-meeting modes (manual / auto / hybrid) — rc3
 *   - Single-shot meeting cap
 *   - escalateToHuman fallback to long human wait
 *   - decideUnblockStrategy + deriveRolesToConvene unit tests
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeArtifact } from "../../../stages/intake/intake.schema.js";
import type { TeamMeetingResult } from "../../../teams/schemas.js";

vi.mock("../../../stages/intake/intake.js", () => ({
  runIntake: vi.fn(),
}));

vi.mock("../../../teams/team-meeting.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../teams/team-meeting.js")
  >("../../../teams/team-meeting.js");
  return {
    ...actual,
    runTeamMeeting: vi.fn(),
  };
});

import { runIntake } from "../../../stages/intake/intake.js";
import { runTeamMeeting } from "../../../teams/team-meeting.js";
import {
  decideUnblockStrategy,
  deriveRolesToConvene,
  resolveIntakeWithUnblock,
} from "./resolve-intake.js";

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

function makeTeamMeetingResult(
  overrides: Partial<TeamMeetingResult> = {},
): TeamMeetingResult {
  return {
    runId: "r-1",
    rolesConvened: ["PM", "TechLead", "Engineer"],
    answers: [
      {
        question: "still ambiguous?",
        answer: "use sensible defaults from the design system",
        sourceRole: "synthesis",
        confidence: "medium",
      },
    ],
    assumptions: [],
    dissent: [],
    consensus: true,
    escalateToHuman: null,
    usage: {
      moderator: { inputTokens: 200, outputTokens: 100 },
      PM: { inputTokens: 80, outputTokens: 40 },
      TechLead: { inputTokens: 80, outputTokens: 40 },
      Engineer: { inputTokens: 80, outputTokens: 40 },
    },
    roleModel: "claude-sonnet-4-6",
    moderatorModel: "claude-opus-4-6",
    ...overrides,
  };
}

describe("resolveIntakeWithUnblock", () => {
  beforeEach(() => {
    vi.mocked(runIntake).mockReset();
    vi.mocked(runTeamMeeting).mockReset();
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

// ── Team-meeting modes (D6) ─────────────────────────────────────────

describe("resolveIntakeWithUnblock — teamMeetingMode", () => {
  beforeEach(() => {
    vi.mocked(runIntake).mockReset();
    vi.mocked(runTeamMeeting).mockReset();
    fakeStep.run.mockClear();
    fakeStep.sendEvent.mockClear();
    fakeStep.waitForEvent.mockReset();
  });

  it("mode=manual: never fires team meeting, uses long human wait every attempt", async () => {
    vi.mocked(runIntake).mockResolvedValue({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    fakeStep.waitForEvent.mockResolvedValue({
      data: { runId: "r-1", answers: [{ question: "still ambiguous?", answer: "x" }] },
    });

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "manual",
      maxAttempts: 3,
    });

    expect(result.kind).toBe("halted");
    expect(vi.mocked(runTeamMeeting)).not.toHaveBeenCalled();
    // 2 unblock loops (attempts 1, 2; attempt 3 halts at max)
    expect(fakeStep.waitForEvent).toHaveBeenCalledTimes(2);
    // All long timeout
    const waitCalls = fakeStep.waitForEvent.mock.calls;
    expect(waitCalls[0]?.[1].timeout).toBe("1d");
    expect(waitCalls[1]?.[1].timeout).toBe("1d");
  });

  it("mode=auto: fires team meeting on the first needs_input attempt", async () => {
    vi.mocked(runIntake)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeIntake({ readiness: "ready" }),
        usage: { inputTokens: 50, outputTokens: 80 },
        model: "claude-sonnet-4-6",
      });
    vi.mocked(runTeamMeeting).mockResolvedValueOnce(makeTeamMeetingResult());

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "auto",
    });

    expect(result.kind).toBe("ready");
    expect(vi.mocked(runTeamMeeting)).toHaveBeenCalledOnce();
    // No human wait at all (auto skips humans)
    expect(fakeStep.waitForEvent).not.toHaveBeenCalled();
    // Team meeting completion event emitted
    const sentEvents = fakeStep.sendEvent.mock.calls.map((c) => c[1].name);
    expect(sentEvents).toContain("tpdc/team-meeting.completed");
    // Result carries the team meeting reference
    if (result.kind === "ready") {
      expect(result.teamMeeting).toBeDefined();
    }
  });

  it("mode=hybrid: attempts 1..N use long wait, attempt N+1 uses short wait + fires team on timeout", async () => {
    vi.mocked(runIntake)
      // Attempts 1, 2, 3 all return blocking
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      // Attempt 4: ready (after team meeting on attempt 3)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeIntake({ readiness: "ready" }),
        usage: { inputTokens: 50, outputTokens: 80 },
        model: "claude-sonnet-4-6",
      });

    // Attempts 1, 2: human answers; Attempt 3 short wait: timeout (null) → team
    fakeStep.waitForEvent
      .mockResolvedValueOnce({
        data: { runId: "r-1", answers: [{ question: "still ambiguous?", answer: "x" }] },
      })
      .mockResolvedValueOnce({
        data: { runId: "r-1", answers: [{ question: "still ambiguous?", answer: "y" }] },
      })
      .mockResolvedValueOnce(null);

    vi.mocked(runTeamMeeting).mockResolvedValueOnce(makeTeamMeetingResult());

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "hybrid",
      teamMeetingNAttempts: 2,
      maxAttempts: 5,
    });

    expect(result.kind).toBe("ready");
    expect(vi.mocked(runTeamMeeting)).toHaveBeenCalledOnce();
    expect(fakeStep.waitForEvent).toHaveBeenCalledTimes(3);
    // First two waits use long timeout
    expect(fakeStep.waitForEvent.mock.calls[0]?.[1].timeout).toBe("1d");
    expect(fakeStep.waitForEvent.mock.calls[1]?.[1].timeout).toBe("1d");
    // Third uses short (attempt 3 = N+1)
    expect(fakeStep.waitForEvent.mock.calls[2]?.[1].timeout).toBe("30m");
  });

  it("mode=hybrid: if human responds in the short window, team meeting is NOT fired", async () => {
    vi.mocked(runIntake)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeIntake({ readiness: "ready" }),
        usage: { inputTokens: 50, outputTokens: 80 },
        model: "claude-sonnet-4-6",
      });

    // All three waits succeed with human answers
    fakeStep.waitForEvent.mockResolvedValue({
      data: { runId: "r-1", answers: [{ question: "still ambiguous?", answer: "x" }] },
    });

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "hybrid",
      teamMeetingNAttempts: 2,
    });

    expect(result.kind).toBe("ready");
    expect(vi.mocked(runTeamMeeting)).not.toHaveBeenCalled();
  });

  it("team meeting cap: after one meeting, subsequent attempts fall back to long human wait", async () => {
    vi.mocked(runIntake).mockResolvedValue({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    vi.mocked(runTeamMeeting).mockResolvedValue(makeTeamMeetingResult());

    // Attempt 1 (auto fires team immediately) → augment → attempt 2 blocks again
    // → falls back to long human wait (cap hit) → human answers x N until maxAttempts
    fakeStep.waitForEvent.mockResolvedValue({
      data: { runId: "r-1", answers: [{ question: "still ambiguous?", answer: "x" }] },
    });

    await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "auto",
      maxAttempts: 4,
    });

    // Team fires ONLY ONCE
    expect(vi.mocked(runTeamMeeting)).toHaveBeenCalledTimes(1);
    // After cap: 3 long waits (attempts 2, 3, 4 has the final intake but no wait after)
    // attempt 1: team fires; attempt 2: long wait; attempt 3: long wait; attempt 4: max (no wait)
    expect(fakeStep.waitForEvent).toHaveBeenCalledTimes(2);
  });

  it("escalateToHuman from team → falls back to long human wait", async () => {
    vi.mocked(runIntake)
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeBlockingIntake(),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        runId: "r-1",
        artifact: makeIntake({ readiness: "ready" }),
        usage: { inputTokens: 50, outputTokens: 80 },
        model: "claude-sonnet-4-6",
      });
    vi.mocked(runTeamMeeting).mockResolvedValueOnce(
      makeTeamMeetingResult({
        escalateToHuman: { reason: "team could not commit on color" },
        consensus: false,
      }),
    );
    fakeStep.waitForEvent.mockResolvedValueOnce({
      data: { runId: "r-1", answers: [{ question: "still ambiguous?", answer: "primary blue" }] },
    });

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "auto",
    });

    expect(result.kind).toBe("ready");
    expect(vi.mocked(runTeamMeeting)).toHaveBeenCalledOnce();
    expect(fakeStep.waitForEvent).toHaveBeenCalledOnce();
    // The fallback wait uses long timeout
    expect(fakeStep.waitForEvent.mock.calls[0]?.[1].timeout).toBe("1d");
    // Augmented intake on retry uses human Q&A (not team-meeting markdown)
    const secondCall = vi.mocked(runIntake).mock.calls[1]?.[0];
    expect(secondCall?.request).toContain("primary blue");
    expect(secondCall?.request).not.toContain("Team meeting resolution");
  });

  it("escalateToHuman with subsequent timeout halts the workflow", async () => {
    vi.mocked(runIntake).mockResolvedValueOnce({
      runId: "r-1",
      artifact: makeBlockingIntake(),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "claude-sonnet-4-6",
    });
    vi.mocked(runTeamMeeting).mockResolvedValueOnce(
      makeTeamMeetingResult({
        escalateToHuman: { reason: "team could not commit" },
      }),
    );
    fakeStep.waitForEvent.mockResolvedValueOnce(null); // timeout on the fallback wait

    const result = await resolveIntakeWithUnblock({
      ...baseOpts,
      teamMeetingMode: "auto",
    });

    expect(result.kind).toBe("halted");
    if (result.kind === "halted") {
      expect(result.reason).toMatch(/team escalated to human; unblock timeout/);
      expect(result.teamMeeting).toBeDefined();
    }
  });
});

// ── Pure helpers ────────────────────────────────────────────────────

describe("decideUnblockStrategy", () => {
  it("manual mode always → long_human_wait", () => {
    expect(
      decideUnblockStrategy({
        mode: "manual",
        attempt: 1,
        N: 2,
        teamMeetingHasFired: false,
      }),
    ).toEqual({ kind: "long_human_wait" });
    expect(
      decideUnblockStrategy({
        mode: "manual",
        attempt: 99,
        N: 2,
        teamMeetingHasFired: false,
      }),
    ).toEqual({ kind: "long_human_wait" });
  });

  it("auto mode → team_meeting_immediate when not yet fired", () => {
    expect(
      decideUnblockStrategy({
        mode: "auto",
        attempt: 1,
        N: 2,
        teamMeetingHasFired: false,
      }),
    ).toEqual({ kind: "team_meeting_immediate" });
  });

  it("auto mode → long_human_wait once cap is hit", () => {
    expect(
      decideUnblockStrategy({
        mode: "auto",
        attempt: 2,
        N: 2,
        teamMeetingHasFired: true,
      }),
    ).toEqual({ kind: "long_human_wait" });
  });

  it("hybrid mode + attempt <= N → long_human_wait", () => {
    expect(
      decideUnblockStrategy({
        mode: "hybrid",
        attempt: 1,
        N: 2,
        teamMeetingHasFired: false,
      }),
    ).toEqual({ kind: "long_human_wait" });
    expect(
      decideUnblockStrategy({
        mode: "hybrid",
        attempt: 2,
        N: 2,
        teamMeetingHasFired: false,
      }),
    ).toEqual({ kind: "long_human_wait" });
  });

  it("hybrid mode + attempt > N → short_human_wait_then_team", () => {
    expect(
      decideUnblockStrategy({
        mode: "hybrid",
        attempt: 3,
        N: 2,
        teamMeetingHasFired: false,
      }),
    ).toEqual({ kind: "short_human_wait_then_team" });
  });

  it("hybrid mode + cap hit → long_human_wait regardless of attempt", () => {
    expect(
      decideUnblockStrategy({
        mode: "hybrid",
        attempt: 5,
        N: 2,
        teamMeetingHasFired: true,
      }),
    ).toEqual({ kind: "long_human_wait" });
  });
});

describe("deriveRolesToConvene", () => {
  it("excludes Designer for non-UI tasks", () => {
    const roles = deriveRolesToConvene(
      [{ question: "Should the cache use LRU or LFU?", owner: "engineering", blocking: true }],
      makeIntake({
        problemStatement: "Queries are slow",
        affectedUsers: "Backend services",
        observableSymptom: "Latency p95 > 500ms",
      }),
    );
    expect(roles).toEqual(["PM", "TechLead", "Engineer"]);
  });

  it("includes Designer when UI keywords appear", () => {
    const roles = deriveRolesToConvene(
      [{ question: "¿Qué color usar para el botón?", owner: "design", blocking: true }],
      makeIntake(),
    );
    expect(roles).toEqual(["PM", "TechLead", "Designer", "Engineer"]);
  });

  it("preserves canonical order PM, TechLead, Designer, Engineer", () => {
    const roles = deriveRolesToConvene(
      [{ question: "card layout tweak", owner: "design", blocking: true }],
      makeIntake(),
    );
    expect(roles).toEqual(["PM", "TechLead", "Designer", "Engineer"]);
  });
});
