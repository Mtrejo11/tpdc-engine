/**
 * Tests for the `tpdc fix` bug-fix flow.
 *
 * Tests:
 * 1. Bug normalizer — well-specified bug
 * 2. Bug normalizer — vague bug that would block
 * 3. Bug renderer — output rendering
 */

import { normalizeBugReport, suggestClarifiedReport, BugContext } from "../src/plugin/handlers/bugNormalizer";
import { renderBugResult } from "../src/plugin/renderers/bugRenderer";
import { RunSummary } from "../src/storage/runs";

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

// ── Test 1: Well-specified bug ─────────────────────────────────────

console.log("\n[Test 1] Well-specified bug normalization\n");
{
  const input =
    "On Android, the TrainingFolderScreen renders video tiles as blank gray boxes. " +
    "Expected: thumbnail with play icon overlay. " +
    "Steps: upload a video, navigate to the folder grid.";

  const ctx = normalizeBugReport(input);

  assert(ctx.extracted.platform === "Android", "Detects Android platform");
  assert(ctx.extracted.screen === "TrainingFolderScreen", "Detects screen name");
  assert(ctx.extracted.expectedBehavior !== undefined, "Extracts expected behavior");
  assert(ctx.extracted.reproContext !== undefined, "Extracts repro context");
  assert(
    ctx.missingFields.length <= 1,
    `Few missing fields (${ctx.missingFields.length})`,
    `missing: ${ctx.missingFields.join(", ")}`,
  );
  assert(
    ctx.normalizedRequest.includes("[Bug Fix]"),
    "Normalized request has [Bug Fix] prefix",
  );
  assert(
    ctx.normalizedRequest.includes("[Android]"),
    "Normalized request includes platform tag",
  );
  assert(
    ctx.normalizedRequest.includes("[TrainingFolderScreen]"),
    "Normalized request includes screen tag",
  );
  assert(ctx.rawInput === input, "Preserves raw input");
}

// ── Test 2: Vague bug that would block ──────────────────────────────

console.log("\n[Test 2] Vague bug normalization (missing context)\n");
{
  const input = "Camera permission locked after denial";
  const ctx = normalizeBugReport(input);

  assert(!ctx.extracted.platform, "No platform detected (correct)");
  assert(!ctx.extracted.screen, "No screen detected (correct)");
  assert(ctx.missingFields.includes("platform"), "Missing: platform");
  assert(ctx.missingFields.includes("screen/component"), "Missing: screen/component");
  assert(ctx.missingFields.includes("expected behavior"), "Missing: expected behavior");
  assert(ctx.missingFields.includes("reproduction steps"), "Missing: reproduction steps");
  assert(ctx.missingFields.length >= 3, `Multiple missing fields (${ctx.missingFields.length})`);

  // Suggested clarified report
  const suggestion = suggestClarifiedReport(ctx);
  assert(suggestion.includes("<iOS / Android / Web>"), "Suggestion has platform placeholder");
  assert(suggestion.includes("<screen or component name>"), "Suggestion has screen placeholder");
  assert(suggestion.includes("Camera permission"), "Suggestion preserves original text");

  // Normalized request should still include the raw text
  assert(ctx.normalizedRequest.includes("Camera permission locked"), "Normalized preserves raw text");
}

// ── Test 3: iOS bug with component name ─────────────────────────────

console.log("\n[Test 3] iOS bug with backtick component\n");
{
  const input =
    "On iOS, the `roomCamera.component` shows a black screen after denying camera permission. " +
    "Expected: should show an alert directing to Settings.";

  const ctx = normalizeBugReport(input);

  assert(ctx.extracted.platform === "iOS", "Detects iOS platform");
  assert(ctx.extracted.screen === "roomCamera.component", "Detects backtick component name");
  assert(ctx.extracted.expectedBehavior !== undefined, "Extracts expected behavior");
  assert(
    ctx.extracted.expectedBehavior!.includes("alert"),
    "Expected behavior mentions alert",
  );
}

// ── Test 4: Bug renderer output — blocked run ──────────────────────

console.log("\n[Test 4] Bug renderer — blocked run\n");
{
  const bugCtx: BugContext = {
    normalizedRequest: "[Bug Fix] Camera permission locked",
    extracted: {},
    missingFields: ["platform", "screen/component", "expected behavior", "reproduction steps"],
    rawInput: "Camera permission locked after denial",
  };

  const run: RunSummary = {
    workflowId: "wf_test_blocked",
    timestamp: "2026-03-15T00:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "blocked",
    totalDurationMs: 60000,
    summary: "Workflow blocked at decompose: insufficient context.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 10000 },
      { capabilityId: "design", status: "passed", durationMs: 20000 },
      { capabilityId: "decompose", status: "blocked", durationMs: 5000, blockReason: "Platform unknown" },
      { capabilityId: "execute", status: "passed", durationMs: 8000 },
      { capabilityId: "validate", status: "passed", durationMs: 12000 },
    ],
    score: 78,
    blockReason: "Platform unknown — cannot determine correct permission API.",
    openQuestions: [{ question: "What platform?", owner: "engineering" }],
    artifactPaths: [],
  };

  const output = renderBugResult(run, bugCtx);

  assert(output.includes("BUG FIX"), "Output has BUG FIX header");
  assert(output.includes("BLOCKED"), "Output shows BLOCKED verdict");
  assert(output.includes("Missing Context"), "Output has Missing Context section");
  assert(output.includes("platform"), "Lists missing platform");
  assert(output.includes("Suggested Clarified Input"), "Has suggested clarified input");
  assert(output.includes("tpdc fix"), "Shows rerun command");
  assert(output.includes("Blocking Reason"), "Shows blocking reason");
  assert(output.includes("Pipeline"), "Shows pipeline section");
  assert(output.includes("wf_test_blocked"), "Shows workflow ID");
}

// ── Test 5: Bug renderer output — passing run ──────────────────────

console.log("\n[Test 5] Bug renderer — passing run\n");
{
  const bugCtx: BugContext = {
    normalizedRequest:
      "[Bug Fix] [Android] [TrainingFolderScreen] Video tiles blank",
    extracted: {
      platform: "Android",
      screen: "TrainingFolderScreen",
      actualBehavior: "Video tiles render as blank gray boxes",
      expectedBehavior: "thumbnail with play icon",
    },
    missingFields: ["reproduction steps"],
    rawInput:
      "On Android, TrainingFolderScreen video tiles render as blank gray boxes. Expected: thumbnail with play icon.",
  };

  const run: RunSummary = {
    workflowId: "wf_test_pass",
    timestamp: "2026-03-15T00:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 120000,
    summary: "Workflow completed successfully.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 30000 },
      { capabilityId: "design", status: "passed", durationMs: 35000 },
      { capabilityId: "decompose", status: "passed", durationMs: 20000 },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 20000 },
    ],
    score: 85,
    findings: [
      { category: "ac_coverage", severity: "minor", description: "All ACs met" },
    ],
    artifactPaths: [],
  };

  const output = renderBugResult(run, bugCtx);

  assert(output.includes("PASS"), "Output shows PASS verdict");
  assert(output.includes("Detected Context"), "Has Detected Context section");
  assert(output.includes("Android"), "Shows detected platform");
  assert(output.includes("TrainingFolderScreen"), "Shows detected screen");
  assert(output.includes("85/100"), "Shows score");
  assert(!output.includes("Blocking Reason"), "No blocking reason for pass");
  assert(output.includes("Findings"), "Shows findings section");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
