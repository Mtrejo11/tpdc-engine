/**
 * Team meeting integration test — hits real Anthropic API.
 *
 * Skipped when ANTHROPIC_API_KEY is not set, so default `npm test` is free.
 * Set the env var to exercise the real codepath end-to-end.
 *
 * Asserts shape and basic sanity, not specific content (model output varies
 * meaningfully across runs — that's literally the bug that drove D6).
 */

import { describe, expect, it } from "vitest";

import type { IntakeArtifact } from "../stages/intake/intake.schema.js";

import { TeamMeetingResultSchema } from "./schemas.js";
import { runTeamMeeting } from "./team-meeting.js";

const skipIfNoApi = !process.env.ANTHROPIC_API_KEY;
const INTEGRATION_TIMEOUT_MS = 120_000;

const intake: IntakeArtifact = {
  title: "Mejorar la visibilidad de los action buttons en la card",
  problemStatement:
    "Los usuarios no notan claramente las acciones primarias en la card del inventario.",
  affectedUsers: "Vendedores que usan la app día a día en mobile",
  observableSymptom:
    "Los botones de acción quedan visualmente apretados, los usuarios tocan el área equivocada.",
  acceptanceCriteria: [
    "Las acciones primarias se distinguen visualmente de las secundarias",
    "El touch target cumple WCAG 2.1 AA (min 44pt)",
  ],
  outOfScope: ["Cambiar la estructura de datos de la card"],
  assumptions: [],
  openQuestions: [
    {
      question: "¿Cuál es la acción primaria de la card (editar, marcar como vendido, otra)?",
      owner: "product",
      blocking: true,
    },
    {
      question: "¿Qué tratamiento visual usar para la primaria (color sólido, outline, icon-only)?",
      owner: "design",
      blocking: true,
    },
  ],
  readiness: "needs_input",
};

describe("runTeamMeeting (integration, real API)", () => {
  it.skipIf(skipIfNoApi)(
    "produces a valid TeamMeetingResult for a vague UI task",
    async () => {
      const result = await runTeamMeeting({
        runId: "integration-team-001",
        originalRequest: "Mejorar la UI de los action buttons de la card",
        intakeSoFar: intake,
        openQuestions: intake.openQuestions.filter((q) => q.blocking),
        rolesToConvene: ["PM", "TechLead", "Designer", "Engineer"],
      });

      // Defensive re-parse against the schema
      const validated = TeamMeetingResultSchema.parse(result);

      expect(validated.runId).toBe("integration-team-001");
      expect(validated.rolesConvened).toEqual([
        "PM",
        "TechLead",
        "Designer",
        "Engineer",
      ]);
      expect(validated.answers.length).toBeGreaterThanOrEqual(1);
      // Either the team converges with answers, or it escalates — both are
      // valid outcomes. What's NOT valid is empty answers + no escalation.
      const hasAnswers = validated.answers.every((a) => a.answer.length > 0);
      const escalated = validated.escalateToHuman !== null;
      expect(hasAnswers || escalated).toBe(true);

      // Token tracking sanity
      expect(validated.usage.moderator.inputTokens).toBeGreaterThan(0);
      expect(validated.usage.moderator.outputTokens).toBeGreaterThan(0);
      expect(validated.usage.PM?.inputTokens).toBeGreaterThan(0);
      expect(validated.usage.Designer?.inputTokens).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.log("[runTeamMeeting integration]", {
        consensus: validated.consensus,
        escalated: validated.escalateToHuman?.reason ?? null,
        answersCount: validated.answers.length,
        assumptionsCount: validated.assumptions.length,
        dissentCount: validated.dissent.length,
        usage: {
          PM: validated.usage.PM,
          TechLead: validated.usage.TechLead,
          Designer: validated.usage.Designer,
          Engineer: validated.usage.Engineer,
          moderator: validated.usage.moderator,
        },
      });
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
