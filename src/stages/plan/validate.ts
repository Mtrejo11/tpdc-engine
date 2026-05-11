/**
 * Plan artifact validator — pure function.
 *
 * In the v0.3 architecture (plugin/MCP per VISION.md), the plan stage runs
 * inside Claude Code with the IntakeArtifact + Read/Grep/Glob in hand.
 * Claude Code produces a candidate `PlanArtifact` and calls this validator
 * (via the `tpdc_validate_plan_artifact` MCP tool) to check shape and DAG
 * integrity. If invalid, the caller iterates with the error feedback.
 *
 * Beyond Zod-parse, this also enforces semantic invariants that Zod can't
 * express directly:
 *   - Step dependencies must reference existing stepNumbers.
 *   - Step dependencies must form a DAG (no cycles, no self-loops).
 *   - When readiness === "ready", steps must be non-empty.
 *   - When readiness !== "ready", blockers should be non-empty.
 */

import { ZodError } from "zod";

import { PlanArtifactSchema, type PlanArtifact } from "./plan.schema.js";

export interface ValidationError {
  /** Dot-joined JSON path to the offending field. */
  path: string;
  /** Human-readable message. */
  message: string;
  /** Error code (Zod's for schema errors; custom for semantic checks). */
  code?: string;
}

export type ValidatePlanResult =
  | { ok: true; artifact: PlanArtifact }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate a candidate plan artifact.
 */
export function validatePlanArtifact(input: unknown): ValidatePlanResult {
  const parsed = PlanArtifactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: formatZodErrors(parsed.error) };
  }

  const semanticErrors = checkSemantics(parsed.data);
  if (semanticErrors.length > 0) {
    return { ok: false, errors: semanticErrors };
  }

  return { ok: true, artifact: parsed.data };
}

function formatZodErrors(err: ZodError): ValidationError[] {
  return err.issues.map((issue) => ({
    path: issue.path
      .map((s) => (typeof s === "number" ? String(s) : s))
      .join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Enforce semantic invariants Zod can't express.
 */
function checkSemantics(plan: PlanArtifact): ValidationError[] {
  const errors: ValidationError[] = [];

  // readiness=ready requires non-empty steps
  if (plan.readiness === "ready" && plan.steps.length === 0) {
    errors.push({
      path: "steps",
      message:
        "readiness is 'ready' but steps array is empty. Either populate steps " +
        "or set readiness to 'needs_input'/'not_ready' with a blocker.",
      code: "empty_steps_when_ready",
    });
  }

  // readiness != ready should have at least one blocker (so the caller knows why)
  if (plan.readiness !== "ready" && plan.blockers.length === 0) {
    errors.push({
      path: "blockers",
      message:
        `readiness is '${plan.readiness}' but no blockers are specified. ` +
        "Add at least one blocker explaining why the plan can't be marked ready.",
      code: "missing_blockers",
    });
  }

  if (plan.steps.length > 0) {
    // stepNumbers must be unique (within the array)
    const numbers = plan.steps.map((s) => s.stepNumber);
    const seen = new Set<number>();
    for (let i = 0; i < numbers.length; i++) {
      const n = numbers[i]!;
      if (seen.has(n)) {
        errors.push({
          path: `steps.${i}.stepNumber`,
          message: `Duplicate stepNumber ${n}. Step numbers must be unique.`,
          code: "duplicate_step_number",
        });
      }
      seen.add(n);
    }

    const knownStepNumbers = new Set(numbers);

    // Each dependency must reference an existing step, not self, and form a DAG
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!;
      for (let j = 0; j < step.dependencies.length; j++) {
        const dep = step.dependencies[j]!;
        if (dep === step.stepNumber) {
          errors.push({
            path: `steps.${i}.dependencies.${j}`,
            message: `Step ${step.stepNumber} cannot depend on itself.`,
            code: "self_dependency",
          });
        } else if (!knownStepNumbers.has(dep)) {
          errors.push({
            path: `steps.${i}.dependencies.${j}`,
            message: `Step ${step.stepNumber} depends on stepNumber ${dep}, which does not exist in this plan.`,
            code: "unknown_dependency",
          });
        }
      }
    }

    // Cycle detection (only if no shallow errors so far for deps)
    if (errors.every((e) => e.code !== "self_dependency" && e.code !== "unknown_dependency")) {
      const cycle = detectCycle(plan.steps);
      if (cycle) {
        errors.push({
          path: "steps",
          message: `Dependency cycle detected: ${cycle.join(" → ")}. Step dependencies must form a DAG.`,
          code: "dependency_cycle",
        });
      }
    }
  }

  return errors;
}

/**
 * Returns the cycle as an array of stepNumbers (closed), or null if none.
 */
function detectCycle(steps: PlanArtifact["steps"]): number[] | null {
  const adj = new Map<number, number[]>();
  for (const s of steps) {
    adj.set(s.stepNumber, s.dependencies);
  }
  const visited = new Set<number>();
  const stack = new Set<number>();
  const path: number[] = [];

  function dfs(node: number): number[] | null {
    if (stack.has(node)) {
      const i = path.indexOf(node);
      return [...path.slice(i), node];
    }
    if (visited.has(node)) return null;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const dep of adj.get(node) ?? []) {
      const result = dfs(dep);
      if (result) return result;
    }
    stack.delete(node);
    path.pop();
    return null;
  }

  for (const s of steps) {
    const cycle = dfs(s.stepNumber);
    if (cycle) return cycle;
  }
  return null;
}
