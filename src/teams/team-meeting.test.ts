/**
 * Tests for the team-of-agents meeting helper.
 *
 * Strategy: mock the Anthropic client's `messages.parse` to return canned
 * outputs in order. Calls happen: PM, TechLead, [Designer], Engineer, then
 * moderator. With Promise.all the role calls register synchronously in
 * `rolesToConvene` order, so `mockResolvedValueOnce` in that same order
 * works deterministically.
 */

import { describe, expect, it, vi } from "vitest";

import type { IntakeArtifact } from "../stages/intake/intake.schema.js";

import {
  type ModeratorOutput,
  type Role,
  type RoleResponse,
} from "./schemas.js";
import {
  runTeamMeeting,
  shouldIncludeDesigner,
} from "./team-meeting.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const intake: IntakeArtifact = {
  title: "Mejorar action buttons de la card",
  problemStatement:
    "Los usuarios no notan los action buttons en la card del inventario.",
  affectedUsers: "Vendedores que usan la app día a día",
  observableSymptom:
    "Los botones de acción quedan apretados visualmente; usuarios tocan el área equivocada.",
  acceptanceCriteria: ["Las acciones primarias se distinguen visualmente"],
  outOfScope: [],
  assumptions: [],
  openQuestions: [
    { question: "¿Cuál acción es primaria?", owner: "product", blocking: true },
    { question: "¿Qué color de contraste usar?", owner: "design", blocking: true },
  ],
  readiness: "needs_input",
};

const openQuestions = intake.openQuestions.filter((q) => q.blocking);

function makeRoleResponse(role: Role, applicableFlags: boolean[] = [true, true]): RoleResponse {
  return {
    role,
    answers: openQuestions.map((q, i) => ({
      question: q.question,
      applicable: applicableFlags[i] ?? true,
      answer: applicableFlags[i] !== false ? `${role} answer for ${q.question}` : undefined,
      confidence: applicableFlags[i] !== false ? "medium" : undefined,
      assumptions: [`${role} assumption for ${q.question}`],
      notes: undefined,
      requiresHuman: false,
      requiresHumanReason: undefined,
    })),
  };
}

function makeModeratorOutput(overrides: Partial<ModeratorOutput> = {}): ModeratorOutput {
  return {
    answers: openQuestions.map((q) => ({
      question: q.question,
      answer: `synthesized answer for ${q.question}`,
      sourceRole: "synthesis",
      confidence: "medium",
    })),
    assumptions: [],
    dissent: [],
    consensus: true,
    escalateToHuman: null,
    ...overrides,
  };
}

interface MockParseResponse {
  parsed_output: unknown;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stop_reason: string;
  content: unknown[];
}

function mockResponse(
  parsed: unknown,
  tokensIn = 100,
  tokensOut = 200,
  contentBlocks: unknown[] = [],
): MockParseResponse {
  return {
    parsed_output: parsed,
    usage: { input_tokens: tokensIn, output_tokens: tokensOut },
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    content: contentBlocks,
  };
}

function makeMockClient(responses: MockParseResponse[]) {
  let i = 0;
  const parse = vi.fn().mockImplementation(async () => {
    if (i >= responses.length) {
      throw new Error(`unexpected extra parse call #${i + 1}`);
    }
    return responses[i++];
  });
  return { messages: { parse } };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("runTeamMeeting", () => {
  it("convenes all 4 roles when rolesToConvene includes all + then the moderator", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM"), 100, 200),
      mockResponse(makeRoleResponse("TechLead"), 110, 210),
      mockResponse(makeRoleResponse("Designer"), 120, 220),
      mockResponse(makeRoleResponse("Engineer"), 130, 230),
      { ...mockResponse(makeModeratorOutput(), 500, 400), model: "claude-opus-4-6" },
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-1",
      originalRequest: "Mejorar la UI de los action buttons",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "TechLead", "Designer", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(client.messages.parse).toHaveBeenCalledTimes(5);
    expect(result.runId).toBe("team-test-1");
    expect(result.rolesConvened).toEqual(["PM", "TechLead", "Designer", "Engineer"]);
    expect(result.consensus).toBe(true);
    expect(result.escalateToHuman).toBeNull();
    expect(result.answers).toHaveLength(2);
    expect(result.moderatorModel).toBe("claude-opus-4-6");
  });

  it("skips Designer when rolesToConvene excludes it (3 roles + moderator = 4 calls)", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM"), 100, 200),
      mockResponse(makeRoleResponse("TechLead"), 110, 210),
      mockResponse(makeRoleResponse("Engineer"), 130, 230),
      { ...mockResponse(makeModeratorOutput(), 500, 400), model: "claude-opus-4-6" },
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-2",
      originalRequest: "Refactorizar el cache layer",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "TechLead", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(client.messages.parse).toHaveBeenCalledTimes(4);
    expect(result.rolesConvened).toEqual(["PM", "TechLead", "Engineer"]);
    expect(result.usage.Designer).toBeUndefined();
    // toMatchObject so additive usage fields (alpha.14 thinkingBlocks, etc.)
    // don't force every assertion to be re-written on schema growth.
    expect(result.usage.PM).toMatchObject({ inputTokens: 100, outputTokens: 200 });
    expect(result.usage.moderator).toMatchObject({ inputTokens: 500, outputTokens: 400 });
  });

  it("passes role responses to the moderator as user content", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    await runTeamMeeting({
      runId: "team-test-3",
      originalRequest: "Mejorar UI",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    // The 3rd call is the moderator; its user content should reference both roles
    const moderatorCall = client.messages.parse.mock.calls[2]?.[0];
    const userContent = moderatorCall?.messages?.[0]?.content as string;
    expect(userContent).toContain("PM response");
    expect(userContent).toContain("Engineer response");
    expect(userContent).toContain("Mejorar UI");
  });

  it("aggregates token usage per role + moderator", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM"), 50, 100),
      mockResponse(makeRoleResponse("TechLead"), 60, 110),
      mockResponse(makeRoleResponse("Engineer"), 70, 120),
      { ...mockResponse(makeModeratorOutput(), 300, 250), model: "claude-opus-4-6" },
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-4",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "TechLead", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(result.usage.PM).toMatchObject({ inputTokens: 50, outputTokens: 100 });
    expect(result.usage.TechLead).toMatchObject({ inputTokens: 60, outputTokens: 110 });
    expect(result.usage.Engineer).toMatchObject({ inputTokens: 70, outputTokens: 120 });
    expect(result.usage.moderator).toMatchObject({ inputTokens: 300, outputTokens: 250 });
    expect(result.usage.Designer).toBeUndefined();
  });

  it("propagates moderator's escalateToHuman and dissent verbatim", async () => {
    const escalated = makeModeratorOutput({
      consensus: false,
      escalateToHuman: { reason: "team could not commit on color contrast without brand guide" },
      dissent: [
        {
          topic: "primary color choice",
          positions: [
            { role: "Designer", position: "use brand primary-600" },
            { role: "PM", position: "match existing card color to avoid surprise" },
          ],
          resolution: "unresolved",
        },
      ],
    });
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Designer")),
      mockResponse(escalated),
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-5",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Designer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(result.consensus).toBe(false);
    expect(result.escalateToHuman?.reason).toMatch(/brand guide/);
    expect(result.dissent).toHaveLength(1);
    expect(result.dissent[0]?.topic).toBe("primary color choice");
    expect(result.dissent[0]?.resolution).toBe("unresolved");
  });

  it("overwrites role label if model emits a different one (we trust caller)", async () => {
    // Model emits role="Designer" even though we asked for "PM"
    const sloppyPMResponse: RoleResponse = {
      ...makeRoleResponse("Designer"),
      role: "Designer",
    };
    const client = makeMockClient([
      mockResponse(sloppyPMResponse),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-6",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    // The result should still know PM was convened
    expect(result.rolesConvened).toEqual(["PM", "Engineer"]);
    expect(result.usage.PM).toBeDefined();
    expect(result.usage.Designer).toBeUndefined();
  });

  it("rejects when rolesToConvene has fewer than 2 entries", async () => {
    const client = makeMockClient([]);
    await expect(
      runTeamMeeting({
        runId: "team-test-7",
        originalRequest: "X",
        intakeSoFar: intake,
        openQuestions,
        rolesToConvene: ["PM"],
        // biome-ignore lint/suspicious/noExplicitAny: typed mock
        client: client as any,
      }),
    ).rejects.toThrow(/at least 2 roles/);
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it("rejects when openQuestions is empty", async () => {
    const client = makeMockClient([]);
    await expect(
      runTeamMeeting({
        runId: "team-test-8",
        originalRequest: "X",
        intakeSoFar: intake,
        openQuestions: [],
        rolesToConvene: ["PM", "Engineer"],
        // biome-ignore lint/suspicious/noExplicitAny: typed mock
        client: client as any,
      }),
    ).rejects.toThrow(/openQuestions must not be empty/);
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  // ── alpha.12: extended thinking on the moderator ──

  it("enables adaptive thinking on the moderator call by default (effort high)", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    await runTeamMeeting({
      runId: "team-test-thinking-default",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    // 0,1 are role calls; 2 is moderator.
    const moderatorCall = client.messages.parse.mock.calls[2]?.[0];
    expect(moderatorCall?.thinking).toEqual({ type: "adaptive" });
    expect(moderatorCall?.output_config?.effort).toBe("high");
    expect(moderatorCall?.max_tokens).toBeGreaterThan(2048);
  });

  it("does NOT enable thinking on the role calls (parallel calls stay cheap)", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    await runTeamMeeting({
      runId: "team-test-thinking-roles",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    const pmCall = client.messages.parse.mock.calls[0]?.[0];
    const engineerCall = client.messages.parse.mock.calls[1]?.[0];
    expect(pmCall?.thinking).toBeUndefined();
    expect(engineerCall?.thinking).toBeUndefined();
  });

  it("disables thinking when moderatorThinkingBudget === 0", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    await runTeamMeeting({
      runId: "team-test-thinking-off",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      moderatorThinkingBudget: 0,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    const moderatorCall = client.messages.parse.mock.calls[2]?.[0];
    expect(moderatorCall?.thinking).toBeUndefined();
  });

  it("respects custom moderatorThinkingBudget via output effort + max_tokens", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    await runTeamMeeting({
      runId: "team-test-thinking-custom",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      moderatorThinkingBudget: 8192,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    const moderatorCall = client.messages.parse.mock.calls[2]?.[0];
    expect(moderatorCall?.thinking).toEqual({ type: "adaptive" });
    expect(moderatorCall?.output_config?.effort).toBe("max");
    expect(moderatorCall?.max_tokens).toBeGreaterThan(8192);
  });

  // ── alpha.14: thinking-block count surfaced through usage ──

  it("surfaces thinkingBlocks: { count: 0, hadRedacted: false } on calls with no thinking content", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput()),
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-thinkblocks-zero",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(result.usage.PM?.thinkingBlocks).toEqual({ count: 0, hadRedacted: false });
    expect(result.usage.Engineer?.thinkingBlocks).toEqual({ count: 0, hadRedacted: false });
    expect(result.usage.moderator.thinkingBlocks).toEqual({ count: 0, hadRedacted: false });
  });

  it("counts thinking blocks on the moderator when content includes them", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput(), 300, 250, [
        { type: "thinking", thinking: "let me reason...", signature: "sig1" },
        { type: "thinking", thinking: "more reasoning...", signature: "sig2" },
        { type: "text", text: "final synthesis" },
      ]),
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-thinkblocks-counted",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(result.usage.moderator.thinkingBlocks).toEqual({ count: 2, hadRedacted: false });
    // Role calls had no thinking content; stays zero.
    expect(result.usage.PM?.thinkingBlocks?.count).toBe(0);
  });

  it("flags hadRedacted: true when at least one block is redacted_thinking", async () => {
    const client = makeMockClient([
      mockResponse(makeRoleResponse("PM")),
      mockResponse(makeRoleResponse("Engineer")),
      mockResponse(makeModeratorOutput(), 300, 250, [
        { type: "thinking", thinking: "visible", signature: "s1" },
        { type: "redacted_thinking", data: "encrypted-redacted-blob" },
        { type: "text", text: "synthesis" },
      ]),
    ]);

    const result = await runTeamMeeting({
      runId: "team-test-thinkblocks-redacted",
      originalRequest: "X",
      intakeSoFar: intake,
      openQuestions,
      rolesToConvene: ["PM", "Engineer"],
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(result.usage.moderator.thinkingBlocks).toEqual({ count: 2, hadRedacted: true });
  });
});

// ── Designer auto-skip heuristic ─────────────────────────────────────

describe("shouldIncludeDesigner", () => {
  const noUiIntake = {
    affectedUsers: "Backend engineers",
    observableSymptom: "Database queries are slow under load",
    problemStatement: "The cache layer is not effective for repeated reads",
  };

  it("returns true when a question contains UI keywords (English)", () => {
    expect(
      shouldIncludeDesigner(
        [{ question: "What color should the primary button be?" }],
        noUiIntake,
      ),
    ).toBe(true);
  });

  it("returns true when a question contains UI keywords (Spanish)", () => {
    expect(
      shouldIncludeDesigner(
        [{ question: "¿Qué color de contraste usar para el botón?" }],
        noUiIntake,
      ),
    ).toBe(true);
  });

  it("returns true when the intake's affectedUsers/symptom mentions UI", () => {
    expect(
      shouldIncludeDesigner(
        [{ question: "Should we paginate the results?" }],
        {
          affectedUsers: "Web users on mobile",
          observableSymptom: "The card layout breaks on small screens",
          problemStatement: "Responsive design issues",
        },
      ),
    ).toBe(true);
  });

  it("returns false for a pure-backend task", () => {
    expect(
      shouldIncludeDesigner(
        [
          { question: "Should the cache use LRU or LFU eviction?" },
          { question: "What's the right TTL for session tokens?" },
        ],
        noUiIntake,
      ),
    ).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(
      shouldIncludeDesigner(
        [{ question: "Use a CARD layout?" }],
        noUiIntake,
      ),
    ).toBe(true);
  });
});
