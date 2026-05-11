/**
 * Tests for the plan artifact validator.
 *
 * Covers both Zod-schema validation and the semantic invariants Zod can't
 * express (DAG, dependency references, readiness/steps consistency).
 */

import { describe, expect, it } from "vitest";

import type { PlanArtifact } from "./plan.schema.js";
import { validatePlanArtifact } from "./validate.js";

function makeValid(overrides: Partial<PlanArtifact> = {}): PlanArtifact {
  return {
    title: "Add password reset flow",
    objective:
      "Provide a self-service password reset so users regain access without support intervention.",
    steps: [
      {
        stepNumber: 1,
        title: "Add reset request endpoint",
        description: "Server-side endpoint that accepts an email and dispatches a reset link.",
        acceptanceCriteria: [
          "POST /auth/password-reset/request returns 200",
          "Reset token is persisted with 30-minute expiry",
        ],
        dependencies: [],
        expectedFiles: ["src/auth/password-reset/request.ts"],
      },
      {
        stepNumber: 2,
        title: "Add reset confirm endpoint",
        description: "Validate token, allow password update, mark token consumed.",
        acceptanceCriteria: [
          "POST /auth/password-reset/confirm rejects invalid tokens",
          "Used tokens cannot be reused",
        ],
        dependencies: [1],
        expectedFiles: ["src/auth/password-reset/confirm.ts"],
      },
    ],
    riskLevel: "medium",
    validationApproach:
      "Run `npm test src/auth/password-reset/` and smoke-test the full flow against staging.",
    testCommands: ["npm test src/auth/password-reset/"],
    assumptions: ["Email delivery infrastructure is in place"],
    blockers: [],
    readiness: "ready",
    ...overrides,
  };
}

describe("validatePlanArtifact — Zod-level", () => {
  it("returns ok:true for a complete valid plan", () => {
    const result = validatePlanArtifact(makeValid());
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when required field is missing", () => {
    const bad = makeValid();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate
    delete (bad as any).riskLevel;
    const result = validatePlanArtifact(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "riskLevel")).toBe(true);
    }
  });

  it("returns ok:false for an invalid riskLevel enum value", () => {
    const result = validatePlanArtifact({ ...makeValid(), riskLevel: "yolo" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "riskLevel")).toBe(true);
    }
  });

  it("applies defaults for optional arrays", () => {
    const minimal = {
      title: "T",
      objective: "O",
      steps: [
        {
          stepNumber: 1,
          title: "S1",
          description: "D",
          acceptanceCriteria: ["AC1"],
        },
      ],
      riskLevel: "low",
      validationApproach: "npm test",
      readiness: "ready",
    };
    const result = validatePlanArtifact(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.testCommands).toEqual([]);
      expect(result.artifact.assumptions).toEqual([]);
      expect(result.artifact.blockers).toEqual([]);
      expect(result.artifact.steps[0]?.dependencies).toEqual([]);
      expect(result.artifact.steps[0]?.expectedFiles).toEqual([]);
    }
  });
});

describe("validatePlanArtifact — semantic invariants", () => {
  it("rejects readiness=ready with empty steps", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      steps: [],
      readiness: "ready",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "empty_steps_when_ready");
      expect(err).toBeDefined();
    }
  });

  it("rejects readiness != ready with no blockers", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      readiness: "needs_input",
      blockers: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "missing_blockers");
      expect(err).toBeDefined();
    }
  });

  it("accepts readiness=needs_input with at least one blocker", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      readiness: "needs_input",
      blockers: [
        { description: "Need design spec for the reset email template", resolution: "PM to provide" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate stepNumbers", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      steps: [
        { stepNumber: 1, title: "A", description: "D", acceptanceCriteria: ["AC"], dependencies: [], expectedFiles: [] },
        { stepNumber: 1, title: "B", description: "D", acceptanceCriteria: ["AC"], dependencies: [], expectedFiles: [] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "duplicate_step_number")).toBe(true);
    }
  });

  it("rejects self-dependency", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      steps: [
        { stepNumber: 1, title: "A", description: "D", acceptanceCriteria: ["AC"], dependencies: [1], expectedFiles: [] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "self_dependency")).toBe(true);
    }
  });

  it("rejects dependency on unknown stepNumber", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      steps: [
        { stepNumber: 1, title: "A", description: "D", acceptanceCriteria: ["AC"], dependencies: [99], expectedFiles: [] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "unknown_dependency");
      expect(err).toBeDefined();
      expect(err?.message).toMatch(/99/);
    }
  });

  it("rejects a dependency cycle", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      steps: [
        { stepNumber: 1, title: "A", description: "D", acceptanceCriteria: ["AC"], dependencies: [2], expectedFiles: [] },
        { stepNumber: 2, title: "B", description: "D", acceptanceCriteria: ["AC"], dependencies: [3], expectedFiles: [] },
        { stepNumber: 3, title: "C", description: "D", acceptanceCriteria: ["AC"], dependencies: [1], expectedFiles: [] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "dependency_cycle");
      expect(err).toBeDefined();
      expect(err?.message).toMatch(/cycle/i);
    }
  });

  it("accepts a valid DAG with multiple branches", () => {
    const result = validatePlanArtifact({
      ...makeValid(),
      steps: [
        { stepNumber: 1, title: "A", description: "D", acceptanceCriteria: ["AC"], dependencies: [], expectedFiles: [] },
        { stepNumber: 2, title: "B", description: "D", acceptanceCriteria: ["AC"], dependencies: [1], expectedFiles: [] },
        { stepNumber: 3, title: "C", description: "D", acceptanceCriteria: ["AC"], dependencies: [1], expectedFiles: [] },
        { stepNumber: 4, title: "D", description: "D", acceptanceCriteria: ["AC"], dependencies: [2, 3], expectedFiles: [] },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
