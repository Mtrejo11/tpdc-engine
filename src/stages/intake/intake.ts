/**
 * Intake stage — TPDC v2.
 *
 * Takes a raw request, calls the executor (Sonnet 4.6) with the intake
 * system prompt and the IntakeArtifact schema, returns the structured ticket.
 *
 * This is the first stage of the ship-feature workflow.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { runExecutor, type ExecutorResult } from "../../runtime/executor.js";
import {
  IntakeArtifactSchema,
  type IntakeArtifact,
} from "./intake.schema.js";
import { INTAKE_SYSTEM_PROMPT } from "./intake.prompt.js";

export interface IntakeRequest {
  runId: string;
  request: string;
  /** Optional model override. Defaults to Sonnet 4.6. */
  model?: string;
  /** Optional client override (for tests). */
  client?: Anthropic;
}

export interface IntakeResult {
  runId: string;
  artifact: IntakeArtifact;
  usage: ExecutorResult<typeof IntakeArtifactSchema>["usage"];
  model: string;
}

export async function runIntake(req: IntakeRequest): Promise<IntakeResult> {
  if (req.request.trim().length === 0) {
    throw new Error("intake: request must not be empty");
  }

  const result = await runExecutor({
    systemPrompt: INTAKE_SYSTEM_PROMPT,
    userInput: req.request,
    outputSchema: IntakeArtifactSchema,
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
