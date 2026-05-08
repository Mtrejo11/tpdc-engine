/**
 * Intake stage integration test — hits real Anthropic API.
 *
 * Skipped when ANTHROPIC_API_KEY is not set, so default `npm test` is free.
 * Set the env var (e.g. via .env or shell) to exercise the real codepath.
 *
 * Asserts shape and basic sanity, not specific content (model output varies).
 */

import { describe, expect, it } from "vitest";
import { runIntake } from "./intake.js";
import { IntakeArtifactSchema } from "./intake.schema.js";

const skipIfNoApi = !process.env.ANTHROPIC_API_KEY;
const INTEGRATION_TIMEOUT_MS = 60_000;

describe("runIntake (integration, real API)", () => {
  it.skipIf(skipIfNoApi)(
    "produces a valid IntakeArtifact for a clear request",
    async () => {
      const result = await runIntake({
        runId: "integration-intake-001",
        request:
          "Users sometimes lose access to their accounts and have to email support to reset their password. We want a self-service flow.",
      });

      // Schema validation already happened inside runExecutor; re-parse defensively.
      const artifact = IntakeArtifactSchema.parse(result.artifact);

      expect(artifact.title.length).toBeGreaterThan(0);
      expect(artifact.problemStatement.length).toBeGreaterThan(0);
      expect(artifact.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(["ready", "needs_input", "not_ready"]).toContain(artifact.readiness);

      // Solution language sanity: should not appear in problemStatement
      const lower = artifact.problemStatement.toLowerCase();
      expect(lower).not.toMatch(/\b(implement|build|add)\b/);

      // Token tracking
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.log("[runIntake integration]", {
        readiness: artifact.readiness,
        acCount: artifact.acceptanceCriteria.length,
        openQuestions: artifact.openQuestions.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
      });
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
