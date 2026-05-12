/**
 * Intake stage tests.
 *
 * We mock the Anthropic client so tests don't hit real API.
 * The mocked client returns a pre-built ParsedMessage with parsed_output.
 */

import { describe, expect, it, vi } from "vitest";
import { runIntake } from "./intake.js";
import { IntakeArtifactSchema, type IntakeArtifact } from "./intake.schema.js";

function makeMockClient(parsedOutput: IntakeArtifact) {
  // Anthropic.messages.parse() returns ParsedMessage with usage + parsed_output.
  // We only need the fields runExecutor reads.
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({
        parsed_output: parsedOutput,
        usage: { input_tokens: 100, output_tokens: 200 },
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [],
      }),
    },
  };
}

describe("runIntake", () => {
  it("rejects empty requests before calling the API", async () => {
    const client = makeMockClient({} as IntakeArtifact);
    await expect(
      runIntake({
        runId: "test-1",
        request: "",
        // biome-ignore lint/suspicious/noExplicitAny: typed mock for narrow surface
        client: client as any,
      }),
    ).rejects.toThrow("intake: request must not be empty");
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it("returns the parsed IntakeArtifact when the API succeeds", async () => {
    const fakeArtifact: IntakeArtifact = IntakeArtifactSchema.parse({
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
    });

    const client = makeMockClient(fakeArtifact);

    const result = await runIntake({
      runId: "test-2",
      request: "Add password reset flow",
      // biome-ignore lint/suspicious/noExplicitAny: typed mock for narrow surface
      client: client as any,
    });

    expect(result.runId).toBe("test-2");
    expect(result.artifact).toEqual(fakeArtifact);
    // toMatchObject so additive usage fields (alpha.14 thinkingBlocks etc.)
    // don't force every stage test to be re-written on schema growth.
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 200 });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(client.messages.parse).toHaveBeenCalledOnce();
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
      runIntake({
        runId: "test-3",
        request: "Some request",
        client,
      }),
    ).rejects.toThrow(/no parsed output/i);
  });
});
