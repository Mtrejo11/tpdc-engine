/**
 * Intake artifact validator — pure function.
 *
 * In the v0.3 architecture (plugin/MCP per VISION.md), the intake stage runs
 * inside Claude Code with its native Read/Grep/Glob tools. Claude Code
 * produces a candidate `IntakeArtifact` and calls this validator (via the
 * `tpdc_validate_intake_artifact` MCP tool) to check shape. If invalid, the
 * caller iterates with the error feedback.
 *
 * This module has no I/O and no model calls — just Zod parsing. Easy to test.
 */

import { ZodError } from "zod";

import {
  IntakeArtifactSchema,
  type IntakeArtifact,
} from "./intake.schema.js";

export interface ValidationError {
  /** Dot-joined JSON path to the offending field (e.g., "openQuestions.0.question"). */
  path: string;
  /** Human-readable message from Zod. */
  message: string;
  /** Zod error code (e.g., "invalid_type", "too_small"). */
  code?: string;
}

export type ValidateIntakeResult =
  | { ok: true; artifact: IntakeArtifact }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate a candidate intake artifact against `IntakeArtifactSchema`.
 *
 * - Returns `{ok: true, artifact}` with the parsed (default-applied) artifact
 *   on success. Note: Zod applies schema defaults (e.g., empty arrays for
 *   `outOfScope`, `assumptions`, `openQuestions`) — the returned artifact
 *   may differ from the input.
 * - Returns `{ok: false, errors}` on validation failure. Each error has a
 *   stringified `path` so callers can pinpoint the field.
 */
export function validateIntakeArtifact(input: unknown): ValidateIntakeResult {
  const parsed = IntakeArtifactSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, artifact: parsed.data };
  }
  return { ok: false, errors: formatZodErrors(parsed.error) };
}

function formatZodErrors(err: ZodError): ValidationError[] {
  return err.issues.map((issue) => ({
    path: issue.path
      .map((segment) =>
        typeof segment === "number" ? String(segment) : segment,
      )
      .join("."),
    message: issue.message,
    code: issue.code,
  }));
}
