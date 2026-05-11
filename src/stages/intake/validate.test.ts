/**
 * Tests for the intake validator pure function.
 */

import { describe, expect, it } from "vitest";

import type { IntakeArtifact } from "./intake.schema.js";
import { validateIntakeArtifact } from "./validate.js";

const validInput: IntakeArtifact = {
  title: "Improve product card buttons",
  problemStatement:
    "Users have trouble distinguishing primary from secondary actions on the product card.",
  affectedUsers: "Resellers using the inventory app on mobile",
  observableSymptom:
    "Users tap the wrong button; action buttons appear cramped in the card layout.",
  acceptanceCriteria: [
    "Primary action is visually distinct from secondary actions",
    "Touch targets are >= 44pt per WCAG 2.1 AA",
  ],
  outOfScope: ["Restructure of the card data shape"],
  assumptions: [],
  openQuestions: [],
  readiness: "ready",
};

describe("validateIntakeArtifact", () => {
  it("returns ok:true for a complete valid artifact", () => {
    const result = validateIntakeArtifact(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.title).toBe(validInput.title);
      expect(result.artifact.readiness).toBe("ready");
    }
  });

  it("applies schema defaults for omitted optional arrays", () => {
    const minimal = {
      title: "T",
      problemStatement: "P",
      affectedUsers: "U",
      observableSymptom: "S",
      acceptanceCriteria: ["AC"],
      readiness: "ready",
    };
    const result = validateIntakeArtifact(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.outOfScope).toEqual([]);
      expect(result.artifact.assumptions).toEqual([]);
      expect(result.artifact.openQuestions).toEqual([]);
    }
  });

  it("returns ok:false with errors when acceptanceCriteria is empty", () => {
    const bad = { ...validInput, acceptanceCriteria: [] };
    const result = validateIntakeArtifact(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      const acError = result.errors.find((e) =>
        e.path.startsWith("acceptanceCriteria"),
      );
      expect(acError).toBeDefined();
      // Zod v4 message format: "too small: expected array to have >=1 items"
      expect(acError?.message.toLowerCase()).toMatch(/too small|>=\s*1|at least/);
    }
  });

  it("returns ok:false with multiple errors for multiple bad fields", () => {
    const bad = {
      title: "",
      problemStatement: "",
      acceptanceCriteria: [],
      readiness: "unknown",
    };
    const result = validateIntakeArtifact(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      const paths = result.errors.map((e) => e.path);
      expect(paths).toContain("title");
      expect(paths).toContain("readiness");
    }
  });

  it("returns paths with array indices joined by dots", () => {
    const bad = {
      ...validInput,
      openQuestions: [
        { question: "first?", owner: "user", blocking: true },
        // Second is invalid — missing question
        { owner: "user", blocking: true },
      ],
    };
    const result = validateIntakeArtifact(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should pinpoint openQuestions.1.question
      const indexed = result.errors.find((e) => /^openQuestions\.1\./.test(e.path));
      expect(indexed).toBeDefined();
    }
  });

  it("rejects readiness outside the allowed enum", () => {
    const bad = { ...validInput, readiness: "maybe" };
    const result = validateIntakeArtifact(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const enumError = result.errors.find((e) => e.path === "readiness");
      expect(enumError).toBeDefined();
    }
  });

  it("rejects non-object inputs cleanly (no throw)", () => {
    expect(validateIntakeArtifact(null).ok).toBe(false);
    expect(validateIntakeArtifact(undefined).ok).toBe(false);
    expect(validateIntakeArtifact("not an object").ok).toBe(false);
    expect(validateIntakeArtifact(42).ok).toBe(false);
  });

  it("each error includes a Zod code", () => {
    const bad = { ...validInput, acceptanceCriteria: [] };
    const result = validateIntakeArtifact(bad);
    if (!result.ok) {
      for (const err of result.errors) {
        expect(err.code).toBeTypeOf("string");
        expect(err.code?.length).toBeGreaterThan(0);
      }
    }
  });
});
