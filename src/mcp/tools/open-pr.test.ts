/**
 * Tests for tpdc_open_pr MCP wrapper. runOpenPR is mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntakeArtifact } from "../../stages/intake/intake.schema.js";
import type { PlanArtifact } from "../../stages/plan/plan.schema.js";

vi.mock("../../stages/open-pr/open-pr.js", () => ({
  runOpenPR: vi.fn(),
}));

import { runOpenPR } from "../../stages/open-pr/open-pr.js";
import { openPRTool } from "./open-pr.js";

const parse = (t: string) => JSON.parse(t);

const intake: IntakeArtifact = {
  title: "Add password reset",
  problemStatement: "Users can't recover access.",
  affectedUsers: "End users",
  observableSymptom: "Support tickets requesting manual reset.",
  acceptanceCriteria: ["Self-service reset works end-to-end"],
  outOfScope: [],
  assumptions: [],
  openQuestions: [],
  readiness: "ready",
};

const plan: PlanArtifact = {
  title: "Reset flow",
  objective: "Implement self-service reset.",
  steps: [
    {
      stepNumber: 1,
      title: "Endpoint",
      description: "Add the endpoint.",
      acceptanceCriteria: ["POST /reset works"],
      dependencies: [],
      expectedFiles: ["src/auth/reset.ts"],
    },
  ],
  riskLevel: "medium",
  validationApproach: "npm test",
  testCommands: ["npm test"],
  assumptions: [],
  blockers: [],
  readiness: "ready",
};

const executeResult = {
  runId: "r-1",
  status: "completed",
  worktreePath: "/tmp/wt",
  branch: "tpdc/run-r-1",
  baseSha: "deadbeef",
  filesChanged: ["src/auth/reset.ts"],
  diff: "+ console.log('ok');",
  finalSummary: "Done.",
  toolCallCount: 3,
  turnCount: 2,
  usage: { inputTokens: 100, outputTokens: 50 },
  model: "claude-sonnet-4-6",
};

const validArgs = {
  runId: "r-1",
  repoRoot: "/tmp/repo",
  branch: "tpdc/run-r-1",
  intake,
  plan,
  execute: executeResult,
};

const okPR = {
  runId: "r-1",
  status: "opened" as const,
  prUrl: "https://github.com/owner/repo/pull/42",
  prNumber: 42,
  branch: "tpdc/run-r-1",
  baseBranch: "main",
  title: "Add password reset",
  body: "<rendered body>",
  stdout: "https://github.com/owner/repo/pull/42",
  stderr: "",
  exitCode: 0,
  durationMs: 500,
};

describe("openPRTool", () => {
  beforeEach(() => vi.mocked(runOpenPR).mockReset());

  it("has the expected name + required fields", () => {
    expect(openPRTool.name).toBe("tpdc_open_pr");
    expect(openPRTool.inputSchema.required).toEqual([
      "runId",
      "repoRoot",
      "branch",
      "intake",
      "plan",
      "execute",
    ]);
  });

  it("calls runOpenPR and returns PR info JSON", async () => {
    vi.mocked(runOpenPR).mockResolvedValueOnce(okPR);
    const result = await openPRTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { status: string; prNumber: number; prUrl: string };
    expect(parsed.status).toBe("opened");
    expect(parsed.prNumber).toBe(42);
    expect(parsed.prUrl).toContain("/pull/42");
  });

  it("forwards draft=true + wipReason", async () => {
    vi.mocked(runOpenPR).mockResolvedValueOnce(okPR);
    await openPRTool.handler({ ...validArgs, draft: true, wipReason: "halted at max_turns" });
    const passed = vi.mocked(runOpenPR).mock.calls[0]?.[0];
    expect(passed?.draft).toBe(true);
    expect(passed?.wipReason).toBe("halted at max_turns");
  });

  it("forwards baseBranch override", async () => {
    vi.mocked(runOpenPR).mockResolvedValueOnce(okPR);
    await openPRTool.handler({ ...validArgs, baseBranch: "develop" });
    expect(vi.mocked(runOpenPR).mock.calls[0]?.[0]?.baseBranch).toBe("develop");
  });

  it("rejects when plan is malformed (re-uses PlanArtifactSchema)", async () => {
    const result = await openPRTool.handler({
      ...validArgs,
      plan: { ...plan, riskLevel: "yolo" } as unknown as PlanArtifact,
    });
    expect(result.isError).toBe(true);
    expect(vi.mocked(runOpenPR)).not.toHaveBeenCalled();
  });

  it("does NOT set isError on gh_missing status", async () => {
    vi.mocked(runOpenPR).mockResolvedValueOnce({
      ...okPR,
      status: "gh_missing",
      prUrl: "",
      prNumber: -1,
      errorMessage: "gh CLI not found on PATH.",
    });
    const result = await openPRTool.handler(validArgs);
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text");
    const parsed = parse(block.text) as { status: string };
    expect(parsed.status).toBe("gh_missing");
  });

  it("isError:true on runOpenPR throw", async () => {
    vi.mocked(runOpenPR).mockRejectedValueOnce(new Error("unexpected"));
    const result = await openPRTool.handler(validArgs);
    expect(result.isError).toBe(true);
  });
});
