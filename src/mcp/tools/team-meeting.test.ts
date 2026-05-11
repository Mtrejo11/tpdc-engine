/**
 * Tests for the tpdc_team_meeting MCP wrapper. runTeamMeeting is mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntakeArtifact } from "../../stages/intake/intake.schema.js";
import type { TeamMeetingResult } from "../../teams/schemas.js";

vi.mock("../../teams/team-meeting.js", () => ({
  runTeamMeeting: vi.fn(),
}));

import { runTeamMeeting } from "../../teams/team-meeting.js";
import { teamMeetingTool } from "./team-meeting.js";

const parse = (t: string) => JSON.parse(t);

const intake: IntakeArtifact = {
  title: "Improve product card buttons",
  problemStatement: "Buttons cramped; users tap the wrong one.",
  affectedUsers: "Resellers on mobile",
  observableSymptom: "Touch targets below 44pt; primary action not distinct.",
  acceptanceCriteria: ["Primary action visually distinct", "WCAG AA touch targets"],
  outOfScope: [],
  assumptions: [],
  openQuestions: [
    { question: "Which action is primary?", owner: "product", blocking: true },
    { question: "What visual treatment for primary?", owner: "design", blocking: true },
  ],
  readiness: "needs_input",
};

const validArgs = {
  runId: "r-1",
  originalRequest: "Mejorar UI de los action buttons",
  intakeSoFar: intake,
  openQuestions: intake.openQuestions.filter((q) => q.blocking),
  rolesToConvene: ["PM", "TechLead", "Designer", "Engineer"] as const,
};

const okResult: TeamMeetingResult = {
  runId: "r-1",
  rolesConvened: ["PM", "TechLead", "Designer", "Engineer"],
  answers: [
    {
      question: "Which action is primary?",
      answer: "Mark as sold",
      sourceRole: "PM",
      confidence: "high",
    },
    {
      question: "What visual treatment for primary?",
      answer: "Solid bg-primary-600, 12% larger touch target",
      sourceRole: "Designer",
      confidence: "medium",
    },
  ],
  assumptions: [
    {
      claim: "ProductCard renders at src/components/ProductCard.tsx",
      rationale: "Standard naming convention in this repo.",
      falsifiableBy: "grep -l 'ProductCard' src/components/",
      raisedBy: ["Engineer"],
    },
  ],
  dissent: [],
  consensus: true,
  escalateToHuman: null,
  usage: {
    moderator: { inputTokens: 300, outputTokens: 200 },
    PM: { inputTokens: 80, outputTokens: 40 },
    TechLead: { inputTokens: 80, outputTokens: 40 },
    Designer: { inputTokens: 80, outputTokens: 40 },
    Engineer: { inputTokens: 80, outputTokens: 40 },
  },
  roleModel: "claude-sonnet-4-6",
  moderatorModel: "claude-opus-4-6",
};

describe("teamMeetingTool", () => {
  beforeEach(() => vi.mocked(runTeamMeeting).mockReset());

  it("has the expected name + required fields", () => {
    expect(teamMeetingTool.name).toBe("tpdc_team_meeting");
    expect(teamMeetingTool.inputSchema.required).toEqual([
      "runId",
      "originalRequest",
      "intakeSoFar",
      "openQuestions",
      "rolesToConvene",
    ]);
  });

  it("calls runTeamMeeting and returns the result JSON", async () => {
    vi.mocked(runTeamMeeting).mockResolvedValueOnce(okResult);
    const result = await teamMeetingTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    expect(vi.mocked(runTeamMeeting)).toHaveBeenCalledOnce();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { consensus: boolean; answers: Array<{ sourceRole: string }> };
    expect(parsed.consensus).toBe(true);
    expect(parsed.answers).toHaveLength(2);
    expect(parsed.answers[0]?.sourceRole).toBe("PM");
  });

  it("does NOT set isError when team escalates to human (valid outcome)", async () => {
    vi.mocked(runTeamMeeting).mockResolvedValueOnce({
      ...okResult,
      consensus: false,
      escalateToHuman: { reason: "Need design spec we don't have yet." },
      dissent: [
        {
          topic: "Brand color choice",
          positions: [
            { role: "Designer", position: "Use brand primary-600" },
            { role: "PM", position: "Match existing card color" },
          ],
          resolution: "unresolved",
        },
      ],
    });
    const result = await teamMeetingTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as {
      escalateToHuman: { reason: string } | null;
      dissent: unknown[];
    };
    expect(parsed.escalateToHuman?.reason).toMatch(/design spec/);
    expect(parsed.dissent).toHaveLength(1);
  });

  it("rejects fewer than 2 roles", async () => {
    const result = await teamMeetingTool.handler({
      ...validArgs,
      rolesToConvene: ["PM"],
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runTeamMeeting)).not.toHaveBeenCalled();
  });

  it("rejects empty openQuestions", async () => {
    const result = await teamMeetingTool.handler({
      ...validArgs,
      openQuestions: [],
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runTeamMeeting)).not.toHaveBeenCalled();
  });

  it("rejects malformed intakeSoFar (re-uses IntakeArtifactSchema)", async () => {
    const result = await teamMeetingTool.handler({
      ...validArgs,
      // missing required fields
      intakeSoFar: { title: "x" },
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runTeamMeeting)).not.toHaveBeenCalled();
  });

  it("rejects invalid role enum value", async () => {
    const result = await teamMeetingTool.handler({
      ...validArgs,
      rolesToConvene: ["PM", "Magician"],
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runTeamMeeting)).not.toHaveBeenCalled();
  });

  it("isError:true on runTeamMeeting throw", async () => {
    vi.mocked(runTeamMeeting).mockRejectedValueOnce(new Error("API rate limit"));
    const result = await teamMeetingTool.handler(validArgs);
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { error: string; stage: string };
    expect(parsed.error).toMatch(/rate limit/);
    expect(parsed.stage).toBe("team-meeting");
  });
});
