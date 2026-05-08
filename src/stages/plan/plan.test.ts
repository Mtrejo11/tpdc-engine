/**
 * Plan stage tests.
 *
 * Mocked Anthropic client. We don't hit real API in unit tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { IntakeArtifact } from "../intake/intake.schema.js";
import { runPlan } from "./plan.js";
import { PlanArtifactSchema, type PlanArtifact } from "./plan.schema.js";

function makeMockClient(parsedOutput: PlanArtifact) {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({
        parsed_output: parsedOutput,
        usage: { input_tokens: 500, output_tokens: 800 },
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [],
      }),
    },
  };
}

const fakeReadyIntake: IntakeArtifact = {
  title: "Restore password access for locked-out users",
  problemStatement:
    "Users who forget their password cannot regain access to their accounts.",
  affectedUsers: "End users with active accounts",
  observableSymptom:
    "Users contact support to manually reset; no self-service flow exists.",
  acceptanceCriteria: [
    "User receives a password reset email after submitting the form",
    "Reset link expires after 30 minutes",
    "Reset link can only be used once",
  ],
  outOfScope: ["Multi-factor authentication enrollment"],
  assumptions: ["Email is the verified contact method for all users"],
  openQuestions: [],
  readiness: "ready",
};

describe("runPlan", () => {
  it("rejects null intake before calling the API", async () => {
    const client = makeMockClient({} as PlanArtifact);
    await expect(
      runPlan({
        runId: "test-1",
        // biome-ignore lint/suspicious/noExplicitAny: testing invariant
        intake: null as any,
        // biome-ignore lint/suspicious/noExplicitAny: typed mock
        client: client as any,
      }),
    ).rejects.toThrow("plan: intake must not be null");
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it("rejects intake with empty acceptanceCriteria", async () => {
    const client = makeMockClient({} as PlanArtifact);
    const badIntake: IntakeArtifact = { ...fakeReadyIntake, acceptanceCriteria: [] as never };
    await expect(
      runPlan({
        runId: "test-2",
        intake: badIntake,
        // biome-ignore lint/suspicious/noExplicitAny: typed mock
        client: client as any,
      }),
    ).rejects.toThrow("plan: intake.acceptanceCriteria is empty");
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it("returns the parsed PlanArtifact when the API succeeds", async () => {
    const fakePlan: PlanArtifact = PlanArtifactSchema.parse({
      title: "Self-service password reset flow",
      objective:
        "Provide a password reset link via email so users can regain access without support intervention.",
      steps: [
        {
          stepNumber: 1,
          title: "Add reset request endpoint and email dispatch",
          description:
            "Server-side endpoint that accepts an email, generates a one-use token, persists it with expiry, and triggers an email.",
          acceptanceCriteria: [
            "POST /auth/password-reset/request returns 200 for any submitted email",
            "Email is dispatched containing a reset link with a token query param",
            "Token row is persisted with 30-minute expiry",
          ],
          dependencies: [],
          expectedFiles: [
            "src/auth/password-reset/request.ts",
            "src/email/templates/password-reset.ts",
          ],
        },
        {
          stepNumber: 2,
          title: "Add reset confirmation endpoint",
          description: "Endpoint that validates the token, allows password update, marks token used.",
          acceptanceCriteria: [
            "POST /auth/password-reset/confirm validates the token before accepting a new password",
            "Token cannot be reused after a successful reset",
            "Expired tokens are rejected with 410",
          ],
          dependencies: [1],
          expectedFiles: ["src/auth/password-reset/confirm.ts"],
        },
      ],
      riskLevel: "medium",
      validationApproach:
        "Run `npm test src/auth/password-reset/`; smoke test the full request → email → confirm flow against staging.",
      assumptions: ["Email delivery infrastructure is in place"],
      blockers: [],
      readiness: "ready",
    });

    const client = makeMockClient(fakePlan);

    const result = await runPlan({
      runId: "test-3",
      intake: fakeReadyIntake,
      // biome-ignore lint/suspicious/noExplicitAny: typed mock
      client: client as any,
    });

    expect(result.runId).toBe("test-3");
    expect(result.artifact).toEqual(fakePlan);
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 800 });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(client.messages.parse).toHaveBeenCalledOnce();

    // Confirm the API received a stringified intake.
    const callArgs = client.messages.parse.mock.calls[0]?.[0];
    expect(callArgs?.messages?.[0]?.content).toContain(fakeReadyIntake.problemStatement);
  });

  it("throws if the API returns no parsed_output", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: synthesizing edge case
    const client: any = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          parsed_output: null,
          usage: { input_tokens: 50, output_tokens: 0 },
          model: "claude-sonnet-4-6",
          stop_reason: "max_tokens",
          content: [],
        }),
      },
    };

    await expect(
      runPlan({
        runId: "test-4",
        intake: fakeReadyIntake,
        client,
      }),
    ).rejects.toThrow(/no parsed output/i);
  });
});
