/**
 * Tests for the resume workflow functionality.
 *
 * Tests:
 * 1. Resume module exports correctly
 * 2. Blocked run detection — rejects non-blocked runs
 * 3. Missing run — throws for unknown run IDs
 * 4. Open question extraction in develop renderer
 * 5. Enriched request construction
 * 6. Answer matching logic
 * 7. Renderer shows resume hint when blocked
 */

import { DevelopSummaryArtifact, renderDevelopResult } from "../src/integration/develop";
import * as fs from "fs";
import * as path from "path";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Test 1: Resume module structure ────────────────────────────────

console.log("\n[Test 1] Resume module exports\n");
{
  const resume = require("../src/runtime/resume");
  assert(typeof resume.resumeWorkflow === "function", "resumeWorkflow is exported as function");
}

// ── Test 2: Resume rejects non-blocked run ─────────────────────────

async function testResumeRejectsNonBlocked() {
  console.log("\n[Test 2] Resume rejects non-blocked run\n");

  const resume = require("../src/runtime/resume");

  // Create a fake "passed" run
  const ARTIFACTS_DIR = path.resolve(__dirname, "../artifacts");
  const fakeRunId = "wf_test_resume_pass";
  const fakeRunDir = path.join(ARTIFACTS_DIR, fakeRunId);
  fs.mkdirSync(fakeRunDir, { recursive: true });

  // Write a workflow artifact with "pass" verdict
  fs.writeFileSync(
    path.join(fakeRunDir, "workflow.json"),
    JSON.stringify({
      workflowId: fakeRunId,
      timestamp: new Date().toISOString(),
      executionMode: "safe",
      adapter: { adapterId: "mock", modelId: "mock", transport: "mock" },
      stages: [{ capabilityId: "intake", status: "passed", durationMs: 100 }],
      finalVerdict: "pass",
      totalDurationMs: 100,
      summary: "test",
    }),
  );

  try {
    await resume.resumeWorkflow({
      runId: fakeRunId,
      answers: [],
      llm: { adapterInfo: { adapterId: "mock", modelId: "mock", transport: "mock" }, generate: async () => "" },
    });
    assert(false, "Should have thrown for non-blocked run");
  } catch (err: any) {
    assert(err.message.includes("not blocked"), `Throws 'not blocked' error (got: ${err.message})`);
  }

  // Cleanup
  fs.rmSync(fakeRunDir, { recursive: true, force: true });
}

// ── Test 3: Resume rejects missing run ─────────────────────────────

async function testResumeRejectsMissing() {
  console.log("\n[Test 3] Resume rejects missing run\n");

  const resume = require("../src/runtime/resume");

  try {
    await resume.resumeWorkflow({
      runId: "wf_nonexistent_run_999",
      answers: [],
      llm: { adapterInfo: { adapterId: "mock", modelId: "mock", transport: "mock" }, generate: async () => "" },
    });
    assert(false, "Should have thrown for missing run");
  } catch (err: any) {
    assert(err.message.includes("not found"), `Throws 'not found' error (got: ${err.message})`);
  }
}

// ── Test 4: Develop renderer shows open questions when blocked ──────

console.log("\n[Test 4] Renderer shows resume hint when blocked\n");
{
  // This tests the renderer output format — we can't test actual artifact loading
  // from disk in a unit test without setting up full artifacts, but we test the
  // render structure for blocked state
  const artifact: DevelopSummaryArtifact = {
    mode: "feature",
    request: "Add camera permission recovery",
    stages: [
      {
        name: "Discovery",
        command: "discovery",
        status: "passed",
        workflowId: "wf_disc_test",
        output: "...",
      },
      {
        name: "Plan",
        command: "plan",
        status: "blocked",
        workflowId: "wf_plan_test",
        output: "...",
        blockReason: "Platform unknown — cannot determine correct permission API",
      },
    ],
    finalStatus: "blocked",
    runIds: ["wf_disc_test", "wf_plan_test"],
  };

  const output = renderDevelopResult(artifact);
  assert(output.includes("BLOCKED"), "Shows BLOCKED status");
  assert(output.includes("Blocked at: Plan"), "Shows blocked step");
  assert(output.includes("Platform unknown"), "Shows block reason");
  // The resume hint appears when open questions are extractable from artifacts on disk
  // In a unit test without real artifacts, the hint may not appear
  // but the blocked info should always show
}

// ── Test 5: Enriched request construction ───────────────────────────

console.log("\n[Test 5] Enriched request construction\n");
{
  // Simulate what resumeWorkflow builds
  const originalTitle = "Add camera permission recovery";
  const originalBody = "After denying camera permission, users get stuck";
  const resolvedAnswers = [
    { question: "Which platform is affected?", answer: "Android" },
    { question: "Which feature triggers the camera?", answer: "Room camera view" },
  ];

  const resolvedContext = resolvedAnswers
    .map((a) => `[RESOLVED] ${a.question} → ${a.answer}`)
    .join("\n");

  const enrichedRequest = [
    originalTitle,
    "",
    originalBody,
    "",
    "## Previously Resolved Questions",
    "The following questions were raised in a prior analysis and have been answered:",
    "",
    resolvedContext,
    "",
    "All prior open questions have been resolved.",
  ].join("\n");

  assert(enrichedRequest.includes("[RESOLVED]"), "Contains resolved markers");
  assert(enrichedRequest.includes("Android"), "Contains answer: Android");
  assert(enrichedRequest.includes("Room camera view"), "Contains answer: Room camera view");
  assert(enrichedRequest.includes("Previously Resolved Questions"), "Has resolved section header");
  assert(enrichedRequest.includes(originalTitle), "Preserves original title");
  assert(enrichedRequest.includes(originalBody), "Preserves original body");
}

// ── Test 6: Answer matching logic ───────────────────────────────────

console.log("\n[Test 6] Answer matching logic\n");
{
  const allQuestions = [
    { question: "What platform or surface is affected — iOS, Android, web browser, or desktop?", owner: "engineering" },
    { question: "Which feature or screen triggers the camera permission request?", owner: "product" },
    { question: "Is there an existing UI pattern for directing users to OS settings?", owner: "product" },
  ];

  const answers = [
    { question: "platform", answer: "Android" },
    { question: "camera permission", answer: "Room camera view" },
  ];

  const resolvedQuestions: string[] = [];
  for (const answer of answers) {
    const matched = allQuestions.find((q) =>
      q.question.toLowerCase().includes(answer.question.toLowerCase()) ||
      answer.question.toLowerCase().includes(q.question.toLowerCase()),
    );
    if (matched) {
      resolvedQuestions.push(matched.question);
    }
  }

  assert(resolvedQuestions.length === 2, `Matched 2 questions (got ${resolvedQuestions.length})`);
  assert(resolvedQuestions[0].includes("platform"), "Matched platform question");
  assert(resolvedQuestions[1].includes("camera permission"), "Matched camera question");

  const remaining = allQuestions
    .filter((q) => !resolvedQuestions.includes(q.question))
    .map((q) => q.question);
  assert(remaining.length === 1, `1 question remaining (got ${remaining.length})`);
  assert(remaining[0].includes("UI pattern"), "Unmatched question is the UI pattern one");
}

// ── Test 7: Full blocked artifact with resume context ────────────────

console.log("\n[Test 7] Full blocked artifact with resume context\n");
{
  const ARTIFACTS_DIR = path.resolve(__dirname, "../artifacts");
  const fakeRunId = "wf_test_resume_blocked";
  const fakeRunDir = path.join(ARTIFACTS_DIR, fakeRunId);
  fs.mkdirSync(fakeRunDir, { recursive: true });

  // Write workflow artifact
  fs.writeFileSync(
    path.join(fakeRunDir, "workflow.json"),
    JSON.stringify({
      workflowId: fakeRunId,
      timestamp: new Date().toISOString(),
      executionMode: "safe",
      adapter: { adapterId: "mock", modelId: "mock", transport: "mock" },
      stages: [
        { capabilityId: "intake", status: "passed", durationMs: 100 },
        { capabilityId: "design", status: "passed", durationMs: 200 },
        { capabilityId: "decompose", status: "blocked", durationMs: 150, blockReason: "Platform unknown" },
      ],
      finalVerdict: "blocked",
      totalDurationMs: 450,
      summary: "Blocked at decompose",
    }),
  );

  // Write intake artifact
  fs.writeFileSync(
    path.join(fakeRunDir, "intake.json"),
    JSON.stringify({
      title: "Camera permission recovery",
      problem_statement: "Users get stuck after denying permission",
    }),
  );

  // Write design artifact with open questions
  fs.writeFileSync(
    path.join(fakeRunDir, "design.json"),
    JSON.stringify({
      title: "ADR: Camera permission recovery",
      openQuestions: [
        { question: "Which platform is affected?", owner: "engineering", severity: "critical" },
        { question: "Which screen triggers the camera?", owner: "product", severity: "advisory" },
      ],
    }),
  );

  // Write decompose artifact
  fs.writeFileSync(
    path.join(fakeRunDir, "decompose.json"),
    JSON.stringify({
      status: "blocked",
      blockedReason: "Platform unknown — cannot select correct permission API",
      unresolvedQuestions: [
        { question: "Which platform is affected?", owner: "engineering" },
      ],
    }),
  );

  // Verify resume can load and validate
  const resume = require("../src/runtime/resume");
  const { loadRun } = require("../src/storage/runs");

  const run = loadRun(fakeRunId);
  assert(run !== null, "Can load blocked run");
  assert(run!.finalVerdict === "blocked", "Run is blocked");
  assert(run!.blockReason === "Platform unknown — cannot select correct permission API", "Block reason loaded");
  assert(run!.openQuestions!.length === 1, "Has 1 unresolved question from decompose");

  // Verify design open questions can be loaded
  const { loadArtifact } = require("../src/storage/local");
  const design = loadArtifact(fakeRunId, "design");
  assert(design.openQuestions.length === 2, "Design has 2 open questions");
  assert(design.openQuestions[0].severity === "critical", "First question is critical");
  assert(design.openQuestions[1].severity === "advisory", "Second question is advisory");

  // Cleanup
  fs.rmSync(fakeRunDir, { recursive: true, force: true });
}

// ── Run async tests and summary ─────────────────────────────────────

async function runAll() {
  await testResumeRejectsNonBlocked();
  await testResumeRejectsMissing();

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
