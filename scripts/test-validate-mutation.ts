#!/usr/bin/env npx ts-node
/**
 * Local tests for mutation-aware validation.
 *
 * Tests schema changes, mutation context construction, fixture validity,
 * and backward compatibility — all without LLM calls.
 *
 * Usage:
 *   npx ts-node scripts/test-validate-mutation.ts
 */

import * as fs from "fs";
import * as path from "path";
import { EvalResultSchema } from "tpdc-protocols";

// ── Test harness ─────────────────────────────────────────────────────

interface TestCase { name: string; run: () => void; }
const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) { tests.push({ name, run: fn }); }
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function runTests() {
  console.log(`\n[Validate Mutation Tests] Running ${tests.length} tests\n`);
  for (const t of tests) {
    try { t.run(); console.log(`  [OK] ${t.name}`); passed++; }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [!!] ${t.name}`);
      console.log(`       ${msg}`);
      failed++;
    }
  }
  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

// ── Helpers ──────────────────────────────────────────────────────────

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/validate");

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

// ── Tests: Schema backward compatibility ────────────────────────────

test("EvalResult without mutationAssessment validates (backward compat)", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-100",
    executionStatus: "completed",
    verdict: "pass",
    score: 85,
    acVerifications: [{ ac: "Rate limiting added", verdict: "pass", evidence: "Middleware applied" }],
    stepVerifications: [{ stepNumber: 1, title: "Add middleware", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "Strong" }],
    findings: [{ category: "weak_evidence", severity: "minor", description: "Evidence could be more specific" }],
    summary: "Execution is complete and coherent.",
  });
  assert(result.success, `Schema should accept result without mutationAssessment: ${result.error?.message}`);
});

test("EvalResult with old finding categories validates", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-100",
    executionStatus: "completed",
    verdict: "pass",
    score: 80,
    acVerifications: [{ ac: "Feature added", verdict: "pass", evidence: "Code shows feature" }],
    stepVerifications: [{ stepNumber: 1, title: "Step 1", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "OK" }],
    findings: [
      { category: "missing_evidence", severity: "major", description: "No evidence for step 2" },
      { category: "scope_violation", severity: "minor", description: "Extra file touched" },
      { category: "artifact_gap", severity: "minor", description: "Missing artifact" },
    ],
    summary: "Complete with minor gaps.",
  });
  assert(result.success, `Old finding categories should still validate: ${result.error?.message}`);
});

// ── Tests: New finding categories ───────────────────────────────────

test("Patch mode finding categories validate", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-200",
    executionStatus: "completed",
    verdict: "inconclusive",
    score: 60,
    acVerifications: [{ ac: "Changes applied", verdict: "cannot_verify", evidence: "Cannot verify from report" }],
    stepVerifications: [{ stepNumber: 1, title: "Patch step", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "OK" }],
    findings: [
      { category: "untargeted_patch", severity: "major", description: "Patch modifies unrelated file" },
      { category: "missing_patch", severity: "critical", description: "Step 2 has no patch" },
      { category: "invalid_diff", severity: "minor", description: "Diff has wrong line numbers" },
    ],
    summary: "Patch mode issues found.",
  });
  assert(result.success, `Patch mode finding categories should validate: ${result.error?.message}`);
});

test("Mutation finding categories validate", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-300",
    executionStatus: "completed",
    verdict: "fail",
    score: 40,
    acVerifications: [{ ac: "Apply succeeded", verdict: "fail", evidence: "Apply was rolled back" }],
    stepVerifications: [{ stepNumber: 1, title: "Apply patch", expectedStatus: "completed", actualStatus: "rolled_back", statusCorrect: false, evidenceAssessment: "Apply failed" }],
    findings: [
      { category: "patch_grounding", severity: "major", description: "Patches don't match plan" },
      { category: "apply_integrity", severity: "critical", description: "Apply result inconsistent" },
      { category: "git_traceability", severity: "minor", description: "No branch created" },
      { category: "workflow_inconsistency", severity: "major", description: "Dry-run said safe but apply failed" },
    ],
    summary: "Mutation failed with inconsistencies.",
  });
  assert(result.success, `Mutation finding categories should validate: ${result.error?.message}`);
});

// ── Tests: MutationAssessment schema ────────────────────────────────

test("Full mutationAssessment validates", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-301",
    executionStatus: "completed",
    verdict: "pass",
    score: 90,
    acVerifications: [{ ac: "Rate limiting added", verdict: "pass", evidence: "Middleware and route configured" }],
    stepVerifications: [
      { stepNumber: 1, title: "Create middleware", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "Strong — file created with correct implementation" },
      { stepNumber: 2, title: "Apply to route", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "Strong — route modified correctly" },
    ],
    mutationAssessment: {
      patchGrounding: { score: 95, assessment: "Both patches align with plan steps. Files match targets." },
      applyIntegrity: { score: 100, assessment: "Both files applied successfully. No rollback needed." },
      gitTraceability: { score: 100, assessment: "Branch created, commit with run ID, only 2 files staged." },
      workflowConsistency: { score: 90, assessment: "All stages coherent. Dry-run passed, apply succeeded, git committed." },
      mutationCorrect: true,
      mutationSummary: "Mutation completed successfully with full traceability.",
    },
    summary: "Mutation workflow executed correctly with strong patch quality.",
  });
  assert(result.success, `Full mutationAssessment should validate: ${result.error?.message}`);
});

test("mutationAssessment with low scores validates", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-303",
    executionStatus: "completed",
    verdict: "inconclusive",
    score: 55,
    acVerifications: [{ ac: "Auth refactored", verdict: "cannot_verify", evidence: "Rollback occurred" }],
    stepVerifications: [
      { stepNumber: 1, title: "Update session", expectedStatus: "completed", actualStatus: "rolled_back", statusCorrect: false, evidenceAssessment: "Applied then reverted" },
    ],
    mutationAssessment: {
      patchGrounding: { score: 80, assessment: "Patches aligned with plan." },
      applyIntegrity: { score: 70, assessment: "Rollback triggered correctly after permission error." },
      gitTraceability: { score: 100, assessment: "No git artifacts created — correct for rollback." },
      workflowConsistency: { score: 60, assessment: "Dry-run said safe but apply failed due to permissions." },
      mutationCorrect: true,
      mutationSummary: "Rollback was correctly handled despite apply failure.",
    },
    summary: "Apply failed but rollback was clean.",
  });
  assert(result.success, `Low-score mutationAssessment should validate: ${result.error?.message}`);
});

test("Incomplete mutationAssessment is rejected", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-300",
    executionStatus: "completed",
    verdict: "pass",
    score: 80,
    acVerifications: [{ ac: "AC1", verdict: "pass", evidence: "Evidence" }],
    stepVerifications: [{ stepNumber: 1, title: "Step", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "OK" }],
    mutationAssessment: {
      patchGrounding: { score: 80, assessment: "OK" },
      // Missing other required dimensions
    },
    summary: "Should fail.",
  });
  assert(!result.success, "Incomplete mutationAssessment should be rejected");
});

test("mutationAssessment with out-of-range score is rejected", () => {
  const result = EvalResultSchema.safeParse({
    sourceTicket: "PROJ-300",
    executionStatus: "completed",
    verdict: "pass",
    score: 80,
    acVerifications: [{ ac: "AC1", verdict: "pass", evidence: "Evidence" }],
    stepVerifications: [{ stepNumber: 1, title: "Step", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "OK" }],
    mutationAssessment: {
      patchGrounding: { score: 150, assessment: "OK" },
      applyIntegrity: { score: 80, assessment: "OK" },
      gitTraceability: { score: 80, assessment: "OK" },
      workflowConsistency: { score: 80, assessment: "OK" },
      mutationCorrect: true,
      mutationSummary: "OK",
    },
    summary: "Should fail.",
  });
  assert(!result.success, "Score > 100 should be rejected");
});

// ── Tests: Fixture validity ─────────────────────────────────────────

test("Fixture 04 (apply success) has correct mutation structure", () => {
  const fixture = loadFixture("04_mutation_apply_success.json") as Record<string, unknown>;
  assert(fixture.execution !== undefined, "Should have execution field");
  assert(fixture.mutationContext !== undefined, "Should have mutationContext field");

  const ctx = fixture.mutationContext as Record<string, unknown>;
  assert(ctx.mode === "mutation", "Mode should be mutation");
  assert(ctx.confirmed === true, "Should be confirmed");

  const dryRun = ctx.dryRun as Record<string, unknown>;
  assert(dryRun.safe === true, "Dry-run should be safe");
  assert(dryRun.applicable === 2, "2 patches applicable");

  const apply = ctx.apply as Record<string, unknown>;
  assert(apply.status === "applied", "Apply should succeed");

  const git = ctx.git as Record<string, unknown>;
  assert(git.branchCreated === true, "Branch should be created");
  assert(git.commitCreated === true, "Commit should be created");
});

test("Fixture 05 (dry-run rejected) has no apply/git results", () => {
  const fixture = loadFixture("05_mutation_dryrun_rejected.json") as Record<string, unknown>;
  const ctx = fixture.mutationContext as Record<string, unknown>;
  assert(ctx.confirmed === true, "Was confirmed");

  const dryRun = ctx.dryRun as Record<string, unknown>;
  assert(dryRun.safe === false, "Dry-run should be unsafe");

  const violations = (dryRun.safetyViolations as Array<Record<string, unknown>>);
  assert(violations.length === 1, "Should have 1 violation");
  assert(violations[0].filePath === ".env", "Violation for .env");

  assert(ctx.apply === null, "Apply should be null (not executed)");
  assert(ctx.git === null, "Git should be null (not executed)");
});

test("Fixture 06 (rollback) has correct rollback structure", () => {
  const fixture = loadFixture("06_mutation_rollback.json") as Record<string, unknown>;
  const ctx = fixture.mutationContext as Record<string, unknown>;

  const apply = ctx.apply as Record<string, unknown>;
  assert(apply.status === "rolled_back", "Apply should be rolled_back");

  const rollback = apply.rollback as Record<string, unknown>;
  assert(rollback.triggered === true, "Rollback should be triggered");
  assert(rollback.success === true, "Rollback should succeed");

  const git = ctx.git as Record<string, unknown>;
  assert(git.branchCreated === false, "No branch on rollback");
  assert(git.commitCreated === false, "No commit on rollback");
});

test("Fixture 07 (no confirmation) has no apply/git results", () => {
  const fixture = loadFixture("07_mutation_no_confirmation.json") as Record<string, unknown>;
  const ctx = fixture.mutationContext as Record<string, unknown>;
  assert(ctx.confirmed === false, "Should not be confirmed");

  const dryRun = ctx.dryRun as Record<string, unknown>;
  assert(dryRun.safe === true, "Dry-run passed");
  assert(dryRun.applicable === 2, "Patches were applicable");

  assert(ctx.apply === null, "Apply should be null");
  assert(ctx.git === null, "Git should be null");
});

// ── Tests: Backward compat — old fixtures still work ────────────────

test("Old fixture 01 (blocked execution) is valid JSON", () => {
  const fixture = loadFixture("01_blocked_execution.json") as Record<string, unknown>;
  assert(fixture.sourceTicket !== undefined || fixture.status !== undefined, "Should have expected fields");
  // Old fixtures don't have mutationContext — should be fine as validate input
});

test("Old fixture 02 (completed execution) is valid JSON", () => {
  const fixture = loadFixture("02_completed_execution.json") as Record<string, unknown>;
  assert(fixture.sourceTicket !== undefined || fixture.status !== undefined, "Should have expected fields");
});

test("Old fixture 03 (partial execution) is valid JSON", () => {
  const fixture = loadFixture("03_partial_execution.json") as Record<string, unknown>;
  assert(fixture.sourceTicket !== undefined || fixture.status !== undefined, "Should have expected fields");
});

// ── Tests: Example mutation-aware EvalResult ────────────────────────

test("Example: successful apply EvalResult validates", () => {
  const evalResult = {
    sourceTicket: "PROJ-301",
    executionStatus: "completed",
    verdict: "pass" as const,
    score: 92,
    acVerifications: [
      { ac: "Rate limiting middleware created", verdict: "pass" as const, evidence: "src/middleware/rateLimit.ts created with configurable maxRequests, in-memory store, and 429 response." },
      { ac: "Upload endpoint rate-limited", verdict: "pass" as const, evidence: "src/routes/upload.ts modified to import rateLimit and apply rateLimit(10) to POST /upload." },
    ],
    stepVerifications: [
      { stepNumber: 1, title: "Create rate limiting middleware", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "File created with valid implementation. Diff is a valid create patch." },
      { stepNumber: 2, title: "Apply to upload endpoint", expectedStatus: "completed", actualStatus: "completed", statusCorrect: true, evidenceAssessment: "Route modified with import and middleware application. Diff is minimal and focused." },
    ],
    findings: [],
    mutationAssessment: {
      patchGrounding: { score: 95, assessment: "Both patches directly correspond to plan steps. Target files (rateLimit.ts create, upload.ts modify) match plan intent. Operations are correct." },
      applyIntegrity: { score: 100, assessment: "Both files applied successfully. filesChanged=2 matches 2 patches. No rollback triggered. fileResults are consistent." },
      gitTraceability: { score: 100, assessment: "Branch tpdc/run-20260309-a1b2c3d4 created. Commit with hash present. Only 2 applied files staged. Run ID traceable in branch name." },
      workflowConsistency: { score: 90, assessment: "Pipeline fully coherent: dry-run safe with 2/2 applicable → apply succeeded for 2 files → git committed 2 files. No contradictions." },
      mutationCorrect: true,
      mutationSummary: "Mutation completed correctly. Patches grounded in plan, applied cleanly, committed with full traceability.",
    },
    summary: "Mutation workflow completed successfully. Both patches aligned with plan, applied cleanly, and committed to a traceable branch.",
  };

  const result = EvalResultSchema.safeParse(evalResult);
  assert(result.success, `Successful apply EvalResult should validate: ${result.error?.message}`);
});

test("Example: correct rejection EvalResult validates", () => {
  const evalResult = {
    sourceTicket: "PROJ-302",
    executionStatus: "completed",
    verdict: "pass" as const,
    score: 75,
    acVerifications: [
      { ac: "API keys updated", verdict: "cannot_verify" as const, evidence: "Patches were generated but dry-run rejected due to .env safety violation. Cannot verify actual application." },
    ],
    stepVerifications: [
      { stepNumber: 1, title: "Update .env", expectedStatus: "blocked", actualStatus: "blocked", statusCorrect: true, evidenceAssessment: ".env is in deny list — correct to block this patch." },
      { stepNumber: 2, title: "Update config.ts", expectedStatus: "blocked", actualStatus: "blocked", statusCorrect: true, evidenceAssessment: "Blocked due to upstream .env safety failure — entire dry-run rejected." },
    ],
    findings: [
      { category: "patch_grounding" as const, severity: "major" as const, description: "Step 1 targets .env which is a denied file. Plan should not have included .env modification." },
    ],
    mutationAssessment: {
      patchGrounding: { score: 50, assessment: "Patch targeting .env is a safety violation. Plan should not have targeted a denied file." },
      applyIntegrity: { score: 100, assessment: "Apply was correctly not executed after dry-run rejection. No partial state." },
      gitTraceability: { score: 100, assessment: "No git artifacts created — correct since no apply occurred." },
      workflowConsistency: { score: 90, assessment: "Dry-run correctly identified safety violation and prevented apply. Pipeline behaved correctly." },
      mutationCorrect: true,
      mutationSummary: "Dry-run rejection was correct — .env is a denied file. No mutation occurred, which is the expected behavior.",
    },
    summary: "Dry-run correctly rejected patches targeting .env. The safety boundary worked as intended.",
  };

  const result = EvalResultSchema.safeParse(evalResult);
  assert(result.success, `Correct rejection EvalResult should validate: ${result.error?.message}`);
});

// ── Run ──────────────────────────────────────────────────────────────

runTests();
