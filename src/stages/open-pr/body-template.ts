/**
 * PR body template — TPDC v2.
 *
 * Renders a markdown PR body from the artifacts of intake/plan/execute/run-tests.
 * Pure helper — no I/O, no side effects, no external API calls. Easy to unit-test.
 *
 * The body is structured for a human reviewer to evaluate:
 *   - Summary: what this PR does (intake's title + problem statement)
 *   - Acceptance Criteria: binary checks the change must satisfy
 *   - Plan: ordered steps with their AC
 *   - Validation: commands run + results
 *   - Files Changed: list from execute
 *   - Footer: TPDC run id + how to inspect
 */

import type { IntakeArtifact } from "../intake/intake.schema.js";
import type { PlanArtifact } from "../plan/plan.schema.js";
import type { ExecuteResult } from "../execute/execute.schema.js";
import type { RunTestsResult } from "../run-tests/run-tests.schema.js";

export interface BodyContext {
  runId: string;
  intake: IntakeArtifact;
  plan: PlanArtifact;
  execute: ExecuteResult;
  /** Test results. Omit for WIP paths (e.g., max_turns_exceeded with partial work). */
  tests?: RunTestsResult;
  /**
   * If set, the PR is incomplete and a warning is rendered at the top.
   * Used when the agent halted mid-execution but produced a coherent partial
   * change worth human review (TPDC bug #4 from dogfooding ronda 1).
   */
  wipReason?: string;
}

const TPDC_FOOTER_MARKER = "<!-- generated-by-tpdc-v2 -->";

export function renderPRBody(ctx: BodyContext): string {
  const sections: string[] = [];

  if (ctx.wipReason) sections.push(renderWipWarning(ctx));
  sections.push(renderSummary(ctx));
  sections.push(renderAcceptanceCriteria(ctx));
  sections.push(renderPlan(ctx));
  sections.push(renderValidation(ctx));
  sections.push(renderFilesChanged(ctx));
  sections.push(renderFooter(ctx));

  return sections.filter((s) => s.length > 0).join("\n\n");
}

export function renderPRTitle(ctx: BodyContext): string {
  // Use the intake title; if too long, truncate. GitHub PR titles allow up to 256
  // chars but conventional commit-style PR titles fit ~72.
  const title = ctx.intake.title.trim();
  return title.length > 100 ? `${title.slice(0, 97)}...` : title;
}

function renderSummary(ctx: BodyContext): string {
  return [
    "## Summary",
    "",
    ctx.intake.problemStatement,
  ].join("\n");
}

function renderAcceptanceCriteria(ctx: BodyContext): string {
  if (ctx.intake.acceptanceCriteria.length === 0) return "";
  const lines = ["## Acceptance Criteria", ""];
  for (const ac of ctx.intake.acceptanceCriteria) {
    lines.push(`- [x] ${ac}`);
  }
  return lines.join("\n");
}

function renderPlan(ctx: BodyContext): string {
  const lines = [
    "## Plan",
    "",
    ctx.plan.objective,
    "",
    `**Risk:** ${ctx.plan.riskLevel}`,
    "",
    "### Steps",
    "",
  ];

  for (const step of ctx.plan.steps) {
    lines.push(`${step.stepNumber}. **${step.title}**`);
    lines.push(`   ${step.description}`);
    if (step.dependencies.length > 0) {
      lines.push(`   _Depends on: ${step.dependencies.map((d) => `#${d}`).join(", ")}_`);
    }
    lines.push("");
  }

  if (ctx.plan.assumptions.length > 0) {
    lines.push("### Assumptions");
    lines.push("");
    for (const a of ctx.plan.assumptions) {
      lines.push(`- ${a}`);
    }
  }

  return lines.join("\n").trimEnd();
}

function renderWipWarning(ctx: BodyContext): string {
  return [
    "> ⚠️ **Work in progress — agent halted before finishing.**",
    `> Reason: ${ctx.wipReason}`,
    ">",
    "> The pipeline did not run validation tests on this branch and the",
    "> change may be incomplete. Review carefully before merging or",
    "> updating the branch manually.",
  ].join("\n");
}

function renderValidation(ctx: BodyContext): string {
  const lines = [
    "## Validation",
    "",
    ctx.plan.validationApproach,
    "",
  ];

  if (!ctx.tests || ctx.tests.results.length === 0) {
    lines.push(
      ctx.wipReason
        ? "_Skipped — agent halted before completion (see warning above)._"
        : "_No automated validation commands were run._",
    );
    return lines.join("\n").trimEnd();
  }

  lines.push("### Test Results");
  lines.push("");
  for (const r of ctx.tests.results) {
    const icon = r.status === "passed" ? "✅" : r.status === "failed" ? "❌" : "⚠️";
    const tail = r.status === "passed"
      ? ""
      : r.status === "failed"
        ? ` (exit ${r.exitCode})`
        : ` (${r.errorMessage ?? r.signal ?? "errored"})`;
    lines.push(`- ${icon} \`${r.command}\`${tail} — ${r.durationMs}ms`);
  }
  lines.push("");
  lines.push(
    `**Summary:** ${ctx.tests.summary.passed}/${ctx.tests.summary.total} commands passed (${ctx.tests.totalDurationMs}ms total)`,
  );

  return lines.join("\n");
}

function renderFilesChanged(ctx: BodyContext): string {
  if (ctx.execute.filesChanged.length === 0) {
    return ["## Files Changed", "", "_No files changed._"].join("\n");
  }
  const lines = ["## Files Changed", ""];
  for (const f of ctx.execute.filesChanged) {
    lines.push(`- \`${f}\``);
  }
  return lines.join("\n");
}

function renderFooter(ctx: BodyContext): string {
  // alpha.15 hotfix (dogfood-008 crash): the tpdc_open_pr MCP wrapper accepts
  // `execute` as `z.unknown()` and forwards it here without validation. If
  // the caller (currently the ship skill) ever trims `usage` to save context
  // — or hands us a partial object — we previously crashed on
  // `Cannot read properties of undefined (reading 'inputTokens')`. The
  // renderer now degrades gracefully:
  //  - missing usage → "usage n/a"
  //  - missing individual counters → 0 instead of NaN
  //  - missing branch / turnCount / toolCallCount → "?" placeholder
  // We deliberately do NOT throw here — open-pr is a downstream presentation
  // step; a broken footer should not block a real PR from opening.
  const branch = ctx.execute.branch ?? "?";
  const turns = ctx.execute.turnCount ?? "?";
  const calls = ctx.execute.toolCallCount ?? "?";
  const usageStr = ctx.execute.usage
    ? `${ctx.execute.usage.inputTokens ?? 0}+${ctx.execute.usage.outputTokens ?? 0} tokens`
    : "usage n/a";
  return [
    "---",
    "",
    `<sub>Generated by TPDC v2 · run \`${ctx.runId}\` · branch \`${branch}\` · ${turns} turn(s) / ${calls} tool call(s) · ${usageStr}</sub>`,
    "",
    TPDC_FOOTER_MARKER,
  ].join("\n");
}

/** Exposed for tests / detection of TPDC-generated PR bodies. */
export const TPDC_BODY_MARKER = TPDC_FOOTER_MARKER;
