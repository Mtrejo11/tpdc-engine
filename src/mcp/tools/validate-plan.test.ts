/**
 * Tests for the tpdc_validate_plan_artifact MCP tool.
 */

import { describe, expect, it } from "vitest";

import { validatePlanArtifactTool } from "./validate-plan.js";

function parseResult(text: string): unknown {
  return JSON.parse(text);
}

const validInput = {
  title: "Add password reset flow",
  objective: "Self-service password reset.",
  steps: [
    {
      stepNumber: 1,
      title: "Add reset request endpoint",
      description: "Email-triggered token generation.",
      acceptanceCriteria: ["POST /reset returns 200"],
      dependencies: [],
      expectedFiles: ["src/auth/reset.ts"],
    },
  ],
  riskLevel: "medium",
  validationApproach: "Run `npm test`.",
  testCommands: ["npm test"],
  readiness: "ready",
};

describe("validatePlanArtifactTool", () => {
  it("has the expected name + required input shape", () => {
    expect(validatePlanArtifactTool.name).toBe("tpdc_validate_plan_artifact");
    expect(validatePlanArtifactTool.inputSchema.required).toContain("artifact");
  });

  it("returns ok:true JSON for a valid plan", async () => {
    const result = await validatePlanArtifactTool.handler({ artifact: validInput });
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parseResult(block.text) as { ok: boolean; artifact?: { title: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.title).toBe(validInput.title);
  });

  it("returns ok:false JSON with semantic error code for cycle", async () => {
    const cyclic = {
      ...validInput,
      steps: [
        { stepNumber: 1, title: "A", description: "D", acceptanceCriteria: ["AC"], dependencies: [2], expectedFiles: [] },
        { stepNumber: 2, title: "B", description: "D", acceptanceCriteria: ["AC"], dependencies: [1], expectedFiles: [] },
      ],
    };
    const result = await validatePlanArtifactTool.handler({ artifact: cyclic });
    expect(result.isError).toBeUndefined();
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parseResult(block.text) as {
      ok: boolean;
      errors?: Array<{ code?: string; message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors?.some((e) => e.code === "dependency_cycle")).toBe(true);
  });

  it("returns isError:true when artifact argument is missing", async () => {
    const result = await validatePlanArtifactTool.handler({});
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected text block");
    const parsed = parseResult(block.text) as {
      ok: boolean;
      errors?: Array<{ code?: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors?.[0]?.code).toBe("missing_argument");
  });

  it("does NOT set isError for schema validation failures (tool call succeeded)", async () => {
    const result = await validatePlanArtifactTool.handler({ artifact: { title: 42 } });
    expect(result.isError).toBeUndefined();
  });
});
