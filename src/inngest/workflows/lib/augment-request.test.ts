import { describe, expect, it } from "vitest";
import { augmentRequestWithAnswers } from "./augment-request.js";

describe("augmentRequestWithAnswers", () => {
  it("returns the original request unchanged when answers is empty", () => {
    const original = "Add password reset flow";
    expect(augmentRequestWithAnswers(original, [])).toBe(original);
  });

  it("appends a Clarifications section with Q/A pairs", () => {
    const original = "Add password reset flow";
    const answers = [
      { question: "Which platforms?", answer: "Web only" },
      { question: "Reset link expiry?", answer: "30 minutes" },
    ];

    const result = augmentRequestWithAnswers(original, answers);

    expect(result).toContain("Add password reset flow");
    expect(result).toContain("## Clarifications");
    expect(result).toContain("Q1: Which platforms?");
    expect(result).toContain("A1: Web only");
    expect(result).toContain("Q2: Reset link expiry?");
    expect(result).toContain("A2: 30 minutes");
  });

  it("trims whitespace around the original request and individual answers", () => {
    const result = augmentRequestWithAnswers("  Original  \n\n", [
      { question: "  Q?  ", answer: "  A.  " },
    ]);

    expect(result.startsWith("Original")).toBe(true);
    expect(result).toContain("Q1: Q?");
    expect(result).toContain("A1: A.");
  });

  it("preserves Q/A order", () => {
    const result = augmentRequestWithAnswers("req", [
      { question: "first", answer: "alpha" },
      { question: "second", answer: "beta" },
      { question: "third", answer: "gamma" },
    ]);

    const idxFirst = result.indexOf("Q1: first");
    const idxSecond = result.indexOf("Q2: second");
    const idxThird = result.indexOf("Q3: third");
    expect(idxFirst).toBeLessThan(idxSecond);
    expect(idxSecond).toBeLessThan(idxThird);
  });
});
