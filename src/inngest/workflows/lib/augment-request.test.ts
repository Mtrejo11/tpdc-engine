import { describe, expect, it } from "vitest";

import type { TeamMeetingResult } from "../../../teams/schemas.js";
import {
  augmentRequestWithAnswers,
  augmentRequestWithTeamMeeting,
} from "./augment-request.js";

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

// ── Team meeting augmentation ────────────────────────────────────────

function makeMeeting(overrides: Partial<TeamMeetingResult> = {}): TeamMeetingResult {
  return {
    runId: "r-1",
    rolesConvened: ["PM", "TechLead", "Engineer"],
    answers: [
      {
        question: "Which is the primary action?",
        answer: "Mark as sold",
        sourceRole: "PM",
        confidence: "high",
      },
    ],
    assumptions: [],
    dissent: [],
    consensus: true,
    escalateToHuman: null,
    usage: {
      moderator: { inputTokens: 100, outputTokens: 50 },
      PM: { inputTokens: 80, outputTokens: 40 },
      TechLead: { inputTokens: 80, outputTokens: 40 },
      Engineer: { inputTokens: 80, outputTokens: 40 },
    },
    roleModel: "claude-sonnet-4-6",
    moderatorModel: "claude-opus-4-6",
    ...overrides,
  };
}

describe("augmentRequestWithTeamMeeting", () => {
  it("appends a Team meeting resolution section to the original request", () => {
    const meeting = makeMeeting();
    const result = augmentRequestWithTeamMeeting("Mejorar UI de la card", meeting);

    expect(result).toContain("Mejorar UI de la card");
    expect(result).toContain("## Team meeting resolution");
    expect(result).toContain("PM, TechLead, Engineer + moderator");
  });

  it("renders synthesized answers with role attribution and confidence", () => {
    const meeting = makeMeeting({
      answers: [
        {
          question: "Which is the primary action?",
          answer: "Mark as sold",
          sourceRole: "PM",
          confidence: "high",
        },
        {
          question: "What visual treatment?",
          answer: "Solid primary color, 12% larger size",
          sourceRole: "Designer",
          confidence: "medium",
        },
      ],
    });

    const result = augmentRequestWithTeamMeeting("req", meeting);

    expect(result).toContain("Which is the primary action?");
    expect(result).toContain("(PM, confidence: high)");
    expect(result).toContain("Mark as sold");
    expect(result).toContain("What visual treatment?");
    expect(result).toContain("(Designer, confidence: medium)");
  });

  it("renders assumptions with raisedBy + rationale + falsifiableBy", () => {
    const meeting = makeMeeting({
      assumptions: [
        {
          claim: "The card component is at src/components/Card.tsx",
          rationale: "Standard naming convention in this repo",
          falsifiableBy: "grep 'Card' in src/components",
          raisedBy: ["Engineer", "TechLead"],
        },
      ],
    });

    const result = augmentRequestWithTeamMeeting("req", meeting);

    expect(result).toContain("### Assumptions (commit to these)");
    expect(result).toContain("The card component is at src/components/Card.tsx");
    expect(result).toContain("raised by: Engineer, TechLead");
    expect(result).toContain("Rationale: Standard naming convention");
    expect(result).toContain("Falsifiable by: grep 'Card' in src/components");
  });

  it("renders dissent with positions per role + resolution", () => {
    const meeting = makeMeeting({
      consensus: false,
      dissent: [
        {
          topic: "Primary action choice",
          positions: [
            { role: "PM", position: "ship minimal change first, validate" },
            { role: "Designer", position: "richer treatment with brand color" },
          ],
          resolution: "side with PM (minimal), defer richer proposal to v+1",
        },
      ],
    });

    const result = augmentRequestWithTeamMeeting("req", meeting);

    expect(result).toContain("### Dissent recorded");
    expect(result).toContain("Primary action choice");
    expect(result).toContain("PM: ship minimal change first");
    expect(result).toContain("Designer: richer treatment");
    expect(result).toContain("Moderator resolution: side with PM");
  });

  it("flags consensus=true clearly", () => {
    const result = augmentRequestWithTeamMeeting("req", makeMeeting({ consensus: true }));
    expect(result).toContain("The team reached **consensus**");
  });

  it("flags consensus=false with reviewer guidance", () => {
    const result = augmentRequestWithTeamMeeting(
      "req",
      makeMeeting({ consensus: false }),
    );
    expect(result).toContain("did **not** reach consensus");
    expect(result).toContain("human review");
  });

  it("omits sections when their arrays are empty", () => {
    const meeting = makeMeeting({ assumptions: [], dissent: [] });
    const result = augmentRequestWithTeamMeeting("req", meeting);
    expect(result).not.toContain("### Assumptions");
    expect(result).not.toContain("### Dissent");
  });

  it("ends with guidance to not recur on the same fractal", () => {
    const result = augmentRequestWithTeamMeeting("req", makeMeeting());
    expect(result).toContain("fractal of detail");
  });
});
