/**
 * Tests for the `tpdc assess` analysis/audit flow.
 *
 * Tests:
 * 1. Security assessment normalization + rendering
 * 2. Performance assessment normalization + rendering
 * 3. Architecture assessment normalization + rendering
 * 4. General/unclassified assessment
 * 5. Risk classification logic
 */

import { normalizeAssessment, AssessmentContext } from "../src/plugin/handlers/assessNormalizer";
import { renderAssessResult } from "../src/plugin/renderers/assessRenderer";
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

// ── Helper: build a mock run ─────────────────────────────────────────

function mockRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    workflowId: "wf_test_assess",
    timestamp: "2026-03-15T00:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 90000,
    summary: "Assessment completed.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 15000 },
      { capabilityId: "design", status: "passed", durationMs: 25000 },
      { capabilityId: "decompose", status: "passed", durationMs: 20000 },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 15000 },
    ],
    score: 72,
    findings: [
      { category: "input_validation", severity: "critical", description: "File type not validated before upload" },
      { category: "auth", severity: "major", description: "Missing authorization check on delete endpoint" },
      { category: "logging", severity: "minor", description: "Upload errors not logged" },
    ],
    openQuestions: [
      { question: "Is there a WAF in front of the upload endpoint?", owner: "engineering" },
    ],
    artifactPaths: [],
    ...overrides,
  };
}

// ── Test 1: Security assessment ──────────────────────────────────────

console.log("\n[Test 1] Security assessment normalization\n");
{
  const input = "Evaluate security risks in the image upload pipeline";
  const ctx = normalizeAssessment(input);

  assert(ctx.category === "security", "Detects security category");
  assert(ctx.normalizedRequest.includes("[Assessment]"), "Has [Assessment] tag");
  assert(ctx.normalizedRequest.includes("Security Assessment"), "Has Security Assessment label");
  assert(ctx.normalizedRequest.includes("Do NOT propose code changes"), "Includes no-patch instruction");
  assert(ctx.normalizedRequest.includes(input), "Preserves original input");
  assert(ctx.rawInput === input, "Stores raw input");
}

console.log("\n[Test 1b] Security assessment rendering\n");
{
  const ctx: AssessmentContext = {
    normalizedRequest: "[Assessment] [Security] ...",
    category: "security",
    rawInput: "Evaluate security risks in the image upload pipeline",
  };
  const run = mockRun();
  const output = renderAssessResult(run, ctx);

  assert(output.includes("SECURITY ASSESSMENT"), "Header shows SECURITY ASSESSMENT");
  assert(output.includes("security"), "Shows category");
  assert(output.includes("72/100"), "Shows score");
  assert(output.includes("Findings"), "Has Findings section");
  assert(output.includes("Risk Level"), "Has Risk Level section");
  assert(output.includes("CRITICAL"), "Shows critical risk level");
  assert(output.includes("Pipeline"), "Has Pipeline section");
  assert(output.includes("wf_test_assess"), "Shows run ID");
  assert(output.includes("File type not validated"), "Shows critical finding");
  assert(output.includes("Missing authorization"), "Shows high finding");
  assert(output.includes("Open Questions"), "Shows open questions");
}

// ── Test 2: Performance assessment ───────────────────────────────────

console.log("\n[Test 2] Performance assessment normalization\n");
{
  const input = "Analyze performance bottlenecks in TrainingFolderScreen";
  const ctx = normalizeAssessment(input);

  assert(ctx.category === "performance", "Detects performance category");
  assert(ctx.normalizedRequest.includes("Performance Assessment"), "Has Performance label");
}

console.log("\n[Test 2b] Performance assessment rendering\n");
{
  const ctx: AssessmentContext = {
    normalizedRequest: "[Assessment] [Performance] ...",
    category: "performance",
    rawInput: "Analyze performance bottlenecks in TrainingFolderScreen",
  };
  const run = mockRun({
    score: 88,
    findings: [
      { category: "rendering", severity: "major", description: "Large FlatList re-renders on every state change" },
      { category: "memory", severity: "minor", description: "Image thumbnails not cached" },
    ],
  });
  const output = renderAssessResult(run, ctx);

  assert(output.includes("PERFORMANCE ASSESSMENT"), "Header shows PERFORMANCE ASSESSMENT");
  assert(output.includes("performance"), "Shows category");
  assert(output.includes("88/100"), "Shows score");
  assert(output.includes("FlatList re-renders"), "Shows performance finding");
}

// ── Test 3: Architecture assessment ──────────────────────────────────

console.log("\n[Test 3] Architecture assessment normalization\n");
{
  const input = "Review the separation of concerns between Room and Plant modules";
  const ctx = normalizeAssessment(input);

  assert(ctx.category === "architecture", "Detects architecture category");
  assert(ctx.normalizedRequest.includes("Architecture Assessment"), "Has Architecture label");
}

console.log("\n[Test 3b] Architecture assessment rendering\n");
{
  const ctx: AssessmentContext = {
    normalizedRequest: "[Assessment] [Architecture] ...",
    category: "architecture",
    rawInput: "Review the separation of concerns between Room and Plant modules",
  };
  const run = mockRun({
    score: 65,
    findings: [
      { category: "coupling", severity: "major", description: "Room component directly imports Plant selectors" },
    ],
    blockReason: undefined,
  });
  const output = renderAssessResult(run, ctx);

  assert(output.includes("ARCHITECTURE ASSESSMENT"), "Header shows ARCHITECTURE ASSESSMENT");
  assert(output.includes("Room component directly imports"), "Shows architecture finding");
}

// ── Test 4: General/unclassified assessment ───────────────────────────

console.log("\n[Test 4] General assessment (no category match)\n");
{
  const input = "How well does the codebase handle edge cases in form validation?";
  const ctx = normalizeAssessment(input);

  assert(ctx.category === "general", "Defaults to general category");
  assert(ctx.normalizedRequest.includes("Analysis"), "Has Analysis label");
}

console.log("\n[Test 4b] General assessment rendering\n");
{
  const ctx: AssessmentContext = {
    normalizedRequest: "[Assessment] [Analysis] ...",
    category: "general",
    rawInput: "How well does the codebase handle edge cases?",
  };
  const run = mockRun({ findings: [], score: 90 });
  const output = renderAssessResult(run, ctx);

  assert(output.includes("ANALYSIS"), "Header shows ANALYSIS for general");
  assert(output.includes("No findings identified"), "Shows no findings message");
  assert(output.includes("Overall: LOW"), "Overall risk is LOW when no findings");
}

// ── Test 5: Category detection edge cases ────────────────────────────

console.log("\n[Test 5] Category detection patterns\n");
{
  assert(normalizeAssessment("Check for XSS vulnerabilities").category === "security", "XSS → security");
  assert(normalizeAssessment("Check cross-tenant data leakage").category === "security", "cross-tenant → security");
  assert(normalizeAssessment("Token expiration handling").category === "security", "token → security");
  assert(normalizeAssessment("Slow render on large lists").category === "performance", "slow → performance");
  assert(normalizeAssessment("Memory usage during upload").category === "performance", "memory → performance");
  assert(normalizeAssessment("Bundle size analysis").category === "performance", "bundle size → performance");
  assert(normalizeAssessment("Module coupling review").category === "architecture", "coupling → architecture");
  assert(normalizeAssessment("Circular dependency check").category === "architecture", "circular → architecture");
  assert(normalizeAssessment("SOLID principles compliance").category === "architecture", "solid → architecture");
  assert(normalizeAssessment("How is the user flow?").category === "general", "generic → general");
}

// ── Test 6: No mutation mode ─────────────────────────────────────────

console.log("\n[Test 6] Safe mode enforcement\n");
{
  const ctx = normalizeAssessment("Security audit of auth flow");
  assert(!ctx.normalizedRequest.includes("--apply"), "No apply flag in request");
  assert(ctx.normalizedRequest.includes("Do NOT propose code changes"), "Explicitly says no code changes");
}

// ── Test 7: Blocked assessment ───────────────────────────────────────

console.log("\n[Test 7] Blocked assessment rendering\n");
{
  const ctx: AssessmentContext = {
    normalizedRequest: "[Assessment] [Security] ...",
    category: "security",
    rawInput: "Evaluate encryption at rest for user data",
  };
  const run = mockRun({
    finalVerdict: "blocked",
    score: undefined,
    findings: [],
    blockReason: "Cannot determine storage backend without access to infrastructure config",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 12000 },
      { capabilityId: "design", status: "passed", durationMs: 18000 },
      { capabilityId: "decompose", status: "blocked", durationMs: 8000, blockReason: "Storage backend unknown" },
      { capabilityId: "execute", status: "passed", durationMs: 10000 },
      { capabilityId: "validate", status: "passed", durationMs: 12000 },
    ],
  });
  const output = renderAssessResult(run, ctx);

  assert(output.includes("BLOCKED"), "Shows BLOCKED verdict");
  assert(output.includes("Blocked"), "Has Blocked section");
  assert(output.includes("storage backend"), "Shows blocking reason");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
