/**
 * Plan stage — TPDC v2.
 *
 * Takes an IntakeArtifact, calls the executor with the plan system prompt
 * and PlanArtifact schema, returns the structured plan.
 *
 * Second stage of the ship-feature workflow (intake → plan → execute → ...).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { runExecutor, type ExecutorResult } from "../../runtime/executor.js";
import type { IntakeArtifact } from "../intake/intake.schema.js";
import {
  PlanArtifactSchema,
  type PlanArtifact,
} from "./plan.schema.js";
import { PLAN_SYSTEM_PROMPT } from "./plan.prompt.js";

export interface PlanRequest {
  runId: string;
  intake: IntakeArtifact;
  /** Optional model override. Defaults to Sonnet 4.6. */
  model?: string;
  /** Optional client override (for tests). */
  client?: Anthropic;
}

export interface PlanResult {
  runId: string;
  artifact: PlanArtifact;
  usage: ExecutorResult<typeof PlanArtifactSchema>["usage"];
  model: string;
}

export async function runPlan(req: PlanRequest): Promise<PlanResult> {
  if (req.intake == null) {
    throw new Error("plan: intake must not be null");
  }
  if (req.intake.acceptanceCriteria.length === 0) {
    throw new Error(
      "plan: intake.acceptanceCriteria is empty — refusing to plan against vague input",
    );
  }

  // Serialize the intake artifact as JSON for the LLM. Sonnet handles
  // structured JSON inputs well; we don't need to pretty-print.
  const userInput = JSON.stringify(req.intake, null, 2);

  const result = await runExecutor({
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userInput,
    outputSchema: PlanArtifactSchema,
    model: req.model,
    client: req.client,
  });

  return {
    runId: req.runId,
    artifact: result.output,
    usage: result.usage,
    model: result.model,
  };
}
