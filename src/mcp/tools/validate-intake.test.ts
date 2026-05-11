/**
 * Tests for the tpdc_validate_intake_artifact MCP tool.
 *
 * Asserts the tool handler shape (CallToolResult format) and delegation to
 * the pure validator. The validator itself is exhaustively tested in
 * src/stages/intake/validate.test.ts; here we focus on the MCP adapter.
 */

import { describe, expect, it } from "vitest";

import { validateIntakeArtifactTool } from "./validate-intake.js";

function parseResult(text: string): unknown {
  return JSON.parse(text);
}

const validInput = {
  title: "Improve product card buttons",
  problemStatement:
    "Users have trouble distinguishing primary from secondary actions.",
  affectedUsers: "Resellers using the inventory app",
  observableSymptom: "Users tap the wrong button; layout is cramped.",
  acceptanceCriteria: ["Primary action visually distinct", "Touch targets >= 44pt"],
  readiness: "ready",
};

describe("validateIntakeArtifactTool", () => {
  it("has the expected name + required input shape", () => {
    expect(validateIntakeArtifactTool.name).toBe("tpdc_validate_intake_artifact");
    expect(validateIntakeArtifactTool.inputSchema.required).toContain("artifact");
  });

  it("returns ok:true JSON for a valid artifact", async () => {
    const result = await validateIntakeArtifactTool.handler({ artifact: validInput });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const firstBlock = result.content[0];
    if (firstBlock?.type !== "text") throw new Error("expected text block");
    const parsed = parseResult(firstBlock.text) as {
      ok: boolean;
      artifact?: { title: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.title).toBe(validInput.title);
  });

  it("returns ok:false JSON with errors[] for an invalid artifact", async () => {
    const bad = { ...validInput, acceptanceCriteria: [] };
    const result = await validateIntakeArtifactTool.handler({ artifact: bad });
    expect(result.isError).toBeUndefined();
    const firstBlock = result.content[0];
    if (firstBlock?.type !== "text") throw new Error("expected text block");
    const parsed = parseResult(firstBlock.text) as {
      ok: boolean;
      errors?: Array<{ path: string; message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors?.length).toBeGreaterThanOrEqual(1);
    expect(parsed.errors?.some((e) => e.path.startsWith("acceptanceCriteria"))).toBe(true);
  });

  it("returns isError:true when artifact argument is missing", async () => {
    const result = await validateIntakeArtifactTool.handler({});
    expect(result.isError).toBe(true);
    const firstBlock = result.content[0];
    if (firstBlock?.type !== "text") throw new Error("expected text block");
    const parsed = parseResult(firstBlock.text) as {
      ok: boolean;
      errors?: Array<{ code?: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors?.[0]?.code).toBe("missing_argument");
  });

  it("does NOT set isError for schema validation failures (tool call succeeded)", async () => {
    // Distinguishes "tool errored" from "input rejected by schema".
    const result = await validateIntakeArtifactTool.handler({ artifact: { title: 42 } });
    expect(result.isError).toBeUndefined();
  });
});
