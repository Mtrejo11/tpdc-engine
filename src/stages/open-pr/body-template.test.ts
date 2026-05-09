import { describe, expect, it } from "vitest";
import type { ExecuteResult } from "../execute/execute.schema.js";
import type { IntakeArtifact } from "../intake/intake.schema.js";
import type { PlanArtifact } from "../plan/plan.schema.js";
import type { RunTestsResult } from "../run-tests/run-tests.schema.js";
import { renderPRBody, renderPRTitle, TPDC_BODY_MARKER } from "./body-template.js";

const intake: IntakeArtifact = {
  title: "Restore password access for locked-out users",
  problemStatement:
    "Users who forget their password cannot regain access to their accounts.",
  affectedUsers: "End users with active accounts",
  observableSymptom: "No self-service reset flow exists.",
  acceptanceCriteria: [
    "User receives a password reset email after submitting the form",
    "Reset link expires after 30 minutes",
  ],
  outOfScope: ["MFA enrollment"],
  assumptions: ["Email is the verified contact method"],
  openQuestions: [],
  readiness: "ready",
};

const plan: PlanArtifact = {
  title: "Self-service password reset",
  objective: "Provide a reset link via email so users can regain access.",
  steps: [
    {
      stepNumber: 1,
      title: "Add reset request endpoint",
      description: "POST /auth/reset/request that emails a token.",
      acceptanceCriteria: ["Endpoint returns 200", "Email is sent"],
      dependencies: [],
      expectedFiles: ["src/auth/reset/request.ts"],
    },
    {
      stepNumber: 2,
      title: "Add reset confirmation endpoint",
      description: "Validates token, accepts new password.",
      acceptanceCriteria: ["Token cannot be reused"],
      dependencies: [1],
      expectedFiles: ["src/auth/reset/confirm.ts"],
    },
  ],
  riskLevel: "medium",
  validationApproach: "Run npm test src/auth/; manual smoke against staging.",
  testCommands: ["npm test src/auth/"],
  assumptions: ["Email infra exists"],
  blockers: [],
  readiness: "ready",
};

const execute: ExecuteResult = {
  runId: "r-1",
  status: "completed",
  worktreePath: "/tmp/repo/.tpdc/worktrees/r-1",
  branch: "tpdc/run-r-1",
  baseSha: "abc123",
  filesChanged: ["src/auth/reset/request.ts", "src/auth/reset/confirm.ts"],
  diff: "diff --git ... (truncated)",
  finalSummary: "Implemented both endpoints.",
  toolCallCount: 12,
  turnCount: 6,
  usage: { inputTokens: 4000, outputTokens: 2000 },
  model: "claude-sonnet-4-6",
};

const passingTests: RunTestsResult = {
  runId: "r-1",
  status: "all_passed",
  results: [
    {
      command: "npm test src/auth/",
      status: "passed",
      exitCode: 0,
      stdout: "All tests passed",
      stderr: "",
      durationMs: 1234,
    },
  ],
  totalDurationMs: 1234,
  summary: { total: 1, passed: 1, failed: 0, errored: 0 },
};

describe("renderPRTitle", () => {
  it("uses the intake title verbatim when short enough", () => {
    expect(renderPRTitle({ runId: "r", intake, plan, execute, tests: passingTests })).toBe(
      "Restore password access for locked-out users",
    );
  });

  it("truncates titles longer than 100 chars with ellipsis", () => {
    const longIntake: IntakeArtifact = {
      ...intake,
      title: "A".repeat(110),
    };
    const result = renderPRTitle({ runId: "r", intake: longIntake, plan, execute, tests: passingTests });
    expect(result.length).toBe(100);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("renderPRBody", () => {
  it("includes all primary sections in order", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });

    const summaryIdx = body.indexOf("## Summary");
    const acIdx = body.indexOf("## Acceptance Criteria");
    const planIdx = body.indexOf("## Plan");
    const validationIdx = body.indexOf("## Validation");
    const filesIdx = body.indexOf("## Files Changed");

    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(acIdx).toBeGreaterThan(summaryIdx);
    expect(planIdx).toBeGreaterThan(acIdx);
    expect(validationIdx).toBeGreaterThan(planIdx);
    expect(filesIdx).toBeGreaterThan(validationIdx);
  });

  it("renders each acceptance criterion as a checked checkbox", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });
    expect(body).toContain("- [x] User receives a password reset email after submitting the form");
    expect(body).toContain("- [x] Reset link expires after 30 minutes");
  });

  it("renders plan steps with title + description + dependencies", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });
    expect(body).toContain("**Add reset request endpoint**");
    expect(body).toContain("POST /auth/reset/request that emails a token.");
    expect(body).toContain("_Depends on: #1_");
  });

  it("renders test results with pass/fail icons", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });
    expect(body).toContain("✅");
    expect(body).toContain("`npm test src/auth/`");
    expect(body).toContain("1/1 commands passed");
  });

  it("includes file list", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });
    expect(body).toContain("`src/auth/reset/request.ts`");
    expect(body).toContain("`src/auth/reset/confirm.ts`");
  });

  it("renders failed test commands with exit code and error icon", () => {
    const failingTests: RunTestsResult = {
      ...passingTests,
      status: "some_failed",
      results: [
        {
          command: "npm test",
          status: "failed",
          exitCode: 1,
          stdout: "1 of 5 failed",
          stderr: "",
          durationMs: 500,
        },
      ],
      summary: { total: 1, passed: 0, failed: 1, errored: 0 },
    };
    const body = renderPRBody({ runId: "r", intake, plan, execute, tests: failingTests });
    expect(body).toContain("❌");
    expect(body).toContain("(exit 1)");
  });

  it("renders errored commands with error message", () => {
    const erroredTests: RunTestsResult = {
      ...passingTests,
      status: "errored",
      results: [
        {
          command: "npm test",
          status: "errored",
          exitCode: -1,
          stdout: "",
          stderr: "killed",
          durationMs: 30000,
          errorMessage: "Command timed out",
          signal: "SIGTERM",
        },
      ],
      summary: { total: 1, passed: 0, failed: 0, errored: 1 },
    };
    const body = renderPRBody({ runId: "r", intake, plan, execute, tests: erroredTests });
    expect(body).toContain("⚠️");
    expect(body).toContain("Command timed out");
  });

  it("includes the TPDC marker for detection", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });
    expect(body).toContain(TPDC_BODY_MARKER);
  });

  it("includes runId and metadata in the footer", () => {
    const body = renderPRBody({ runId: "r-1", intake, plan, execute, tests: passingTests });
    expect(body).toContain("run `r-1`");
    expect(body).toContain("branch `tpdc/run-r-1`");
    expect(body).toContain("6 turn(s) / 12 tool call(s)");
    expect(body).toContain("4000+2000 tokens");
  });

  it("handles empty filesChanged with a clear message", () => {
    const noChangesExecute: ExecuteResult = { ...execute, filesChanged: [] };
    const body = renderPRBody({
      runId: "r",
      intake,
      plan,
      execute: noChangesExecute,
      tests: passingTests,
    });
    expect(body).toContain("_No files changed._");
  });

  it("omits assumptions section when assumptions array is empty", () => {
    const planNoAssumptions: PlanArtifact = { ...plan, assumptions: [] };
    const body = renderPRBody({
      runId: "r",
      intake,
      plan: planNoAssumptions,
      execute,
      tests: passingTests,
    });
    expect(body).not.toContain("### Assumptions");
  });

  it("handles plan with risk=high", () => {
    const highRisk: PlanArtifact = { ...plan, riskLevel: "high" };
    const body = renderPRBody({ runId: "r", intake, plan: highRisk, execute, tests: passingTests });
    expect(body).toContain("**Risk:** high");
  });

  describe("WIP path (TPDC bug #4: agent halted at max_turns)", () => {
    it("renders a warning at the top when wipReason is set", () => {
      const body = renderPRBody({
        runId: "r",
        intake,
        plan,
        execute,
        wipReason: "agent halted at max_turns (60 turns / 80 tool calls)",
      });
      // Warning appears before Summary in the body. The warning starts with
      // a markdown blockquote `> ` so the ⚠️ char is at index 2, not 0.
      expect(body.startsWith("> ⚠️ **Work in progress")).toBe(true);
      expect(body).toContain("60 turns / 80 tool calls");
      const warningIdx = body.indexOf("⚠️");
      const summaryIdx = body.indexOf("## Summary");
      expect(warningIdx).toBeLessThan(summaryIdx);
    });

    it("omits the WIP warning when wipReason is unset (normal path)", () => {
      const body = renderPRBody({
        runId: "r",
        intake,
        plan,
        execute,
        tests: passingTests,
      });
      expect(body).not.toContain("Work in progress");
    });

    it("Validation section says skipped when WIP without tests", () => {
      const body = renderPRBody({
        runId: "r",
        intake,
        plan,
        execute,
        wipReason: "agent halted at max_turns",
      });
      expect(body).toContain("## Validation");
      expect(body).toContain("Skipped — agent halted");
      // Test results section should NOT render
      expect(body).not.toContain("### Test Results");
    });

    it("renders normally with tests + no wipReason", () => {
      const body = renderPRBody({
        runId: "r",
        intake,
        plan,
        execute,
        tests: passingTests,
      });
      expect(body).toContain("### Test Results");
      expect(body).not.toContain("Skipped");
    });
  });
});
