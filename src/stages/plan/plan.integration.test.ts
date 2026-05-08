/**
 * Plan stage integration test — hits real Anthropic API.
 *
 * Mocks the intake stage by passing a hardcoded ready IntakeArtifact directly
 * into runPlan. This exercises the production codepath of plan + executor +
 * structured outputs against the real API without fighting intake's gates.
 *
 * Skipped when ANTHROPIC_API_KEY is not set.
 */

import { describe, expect, it } from "vitest";
import type { IntakeArtifact } from "../intake/intake.schema.js";
import { runPlan } from "./plan.js";
import { PlanArtifactSchema } from "./plan.schema.js";

const skipIfNoApi = !process.env.ANTHROPIC_API_KEY;
const INTEGRATION_TIMEOUT_MS = 90_000;

const READY_INTAKE: IntakeArtifact = {
  title: "Restore password access for locked-out users",
  problemStatement:
    "End users who forget their account password cannot regain access without contacting support, which delays them and creates support load.",
  affectedUsers: "End users with active accounts (single-user accounts only)",
  observableSymptom:
    "When a user clicks 'Forgot password' on the login page, the form does nothing — there is no self-service reset flow.",
  acceptanceCriteria: [
    "POST /auth/password-reset/request returns 200 for any submitted email (does not leak whether the email exists)",
    "Submitting the form dispatches a reset email containing a one-use token link",
    "The token is persisted server-side with a 30-minute expiry",
    "POST /auth/password-reset/confirm validates the token before accepting a new password",
    "A successfully used token is marked consumed and rejected on subsequent attempts",
    "Expired tokens are rejected with HTTP 410 and a generic error message",
  ],
  outOfScope: [
    "Multi-factor authentication enrollment changes",
    "Account recovery for users without a verified email",
    "UI styling beyond the existing form layout",
  ],
  assumptions: [
    "Email is the verified contact method for all users",
    "Existing transactional email infrastructure is available",
    "User accounts are single-user (no team/org reset semantics)",
  ],
  openQuestions: [],
  readiness: "ready",
};

describe("runPlan (integration, real API)", () => {
  it.skipIf(skipIfNoApi)(
    "produces a valid PlanArtifact for a ready intake",
    async () => {
      const result = await runPlan({
        runId: "integration-plan-001",
        intake: READY_INTAKE,
      });

      const artifact = PlanArtifactSchema.parse(result.artifact);

      expect(artifact.title.length).toBeGreaterThan(0);
      expect(artifact.objective.length).toBeGreaterThan(0);
      expect(artifact.validationApproach.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(artifact.riskLevel);

      if (artifact.readiness === "ready") {
        expect(artifact.steps.length).toBeGreaterThan(0);

        // Each step must have binary AC
        for (const step of artifact.steps) {
          expect(step.acceptanceCriteria.length).toBeGreaterThan(0);
          expect(step.title.length).toBeGreaterThan(0);
        }

        // Dependencies must reference existing stepNumbers (no dangling refs)
        const stepNumbers = new Set(artifact.steps.map((s) => s.stepNumber));
        for (const step of artifact.steps) {
          for (const dep of step.dependencies) {
            expect(stepNumbers.has(dep)).toBe(true);
            expect(dep).toBeLessThan(step.stepNumber);
          }
        }
      } else {
        // If plan halted, blockers must explain why
        expect(artifact.blockers.length).toBeGreaterThan(0);
      }

      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.log("[runPlan integration]", {
        readiness: artifact.readiness,
        stepCount: artifact.steps.length,
        riskLevel: artifact.riskLevel,
        blockers: artifact.blockers.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
      });
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
