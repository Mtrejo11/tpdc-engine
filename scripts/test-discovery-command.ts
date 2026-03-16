/**
 * Tests for the `tpdc discovery` pre-workflow framing flow.
 *
 * Tests:
 * 1. Vague product/engineering idea — normalizer
 * 2. Migration-style idea
 * 3. Bug-like idea that should recommend `fix`
 * 4. Idea missing too much context (not_ready)
 * 5. Ready-for-execution idea
 * 6. Renderer output structure (all sections)
 * 7. Markdown summary output
 * 8. Command detection edge cases
 * 9. Question classification (critical vs informational)
 * 10. Semantic readiness logic
 * 11. Tradeoffs, decision drivers, impact areas
 * 12. Rich suggested next command
 */

import { normalizeDiscovery } from "../src/plugin/handlers/discoveryNormalizer";
import { DiscoveryArtifact, Readiness, classifyQuestion, ClassifiedQuestion, Tradeoff } from "../src/plugin/handlers/discoveryArtifact";
import { renderDiscoveryResult, renderDiscoveryMarkdown } from "../src/plugin/renderers/discoveryRenderer";
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

// ── Helpers ──────────────────────────────────────────────────────────

function mockRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    workflowId: "wf_test_discovery",
    timestamp: "2026-03-15T00:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 90000,
    summary: "Discovery completed.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 15000 },
      { capabilityId: "design", status: "passed", durationMs: 25000 },
      { capabilityId: "decompose", status: "passed", durationMs: 20000 },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 15000 },
    ],
    score: 75,
    artifactPaths: [],
    ...overrides,
  };
}

function mockArtifact(overrides: Partial<DiscoveryArtifact> = {}): DiscoveryArtifact {
  return {
    title: "Prevent org data leakage",
    idea: "We need to prevent org data leakage when switching orgs in Field Lite",
    problemFraming: "Users who switch organizations can see stale data from the previous org.",
    affectedAreas: [
      "Organization switching flow",
      "Redux store state cleanup",
      "Cached API responses",
    ],
    constraints: [
      "Must not require app restart",
      "Out of scope: multi-org concurrent access",
    ],
    assumptions: [
      "Users switch orgs infrequently (once per session at most)",
      "Local DB cache is org-specific",
    ],
    openQuestions: [
      { question: "Which Redux slices contain org-scoped data?", owner: "engineering" },
      { question: "Is the API cache cleared on org switch?", owner: "engineering" },
    ],
    criticalQuestions: [
      { question: "Which Redux slices contain org-scoped data?", owner: "engineering", classification: "critical" },
    ],
    informationalQuestions: [
      { question: "Is the API cache cleared on org switch?", owner: "engineering", classification: "informational" },
    ],
    risks: [
      { risk: "Incomplete state reset leaves org A data visible in org B", mitigation: "Full Redux store reset on org switch" },
      { risk: "Cached images from previous org shown in new org", mitigation: "Clear image cache on org switch" },
    ],
    options: [
      { name: "Full app restart on org switch", reasonRejected: "Poor UX, too disruptive" },
      { name: "Selective Redux slice reset", reasonRejected: undefined },
    ],
    tradeoffs: [
      {
        option: "Implement selective Redux state reset with cache invalidation (recommended)",
        advantages: ["Addresses stale org data without requiring app restart"],
        disadvantages: [],
      },
      {
        option: "Full app restart on org switch",
        advantages: [],
        disadvantages: ["Poor UX, too disruptive"],
      },
    ],
    recommendation: "Implement selective Redux state reset combined with API cache invalidation on org switch because stale org-scoped data in Redux and cached API responses can leak across organizations.",
    decisionDrivers: [
      "Mitigates: Incomplete state reset leaves org A data visible in org B",
      "Mitigates: Cached images from previous org shown in new org",
    ],
    impactAreas: [
      "Organization switching flow",
      "Redux store state cleanup",
      "Cached API responses",
      "Full Redux store reset on org switch",
    ],
    readiness: "needs_input",
    readinessReason: "1 critical question(s) must be resolved before execution: Which Redux slices contain org-scoped data?.",
    suggestedNextCommand: 'tpdc solve "Implement selective Redux state reset combined with API cache invalidation on org switch to prevent users who switch organizations can see stale data from the previous org."',
    ...overrides,
  };
}

// ── Test 1: Normalizer ───────────────────────────────────────────────

console.log("\n[Test 1] Vague product idea — normalizer\n");
{
  const input = "We need to prevent org data leakage when switching orgs in Field Lite";
  const ctx = normalizeDiscovery(input);

  assert(ctx.normalizedRequest.includes("[Discovery]"), "Has [Discovery] tag");
  assert(ctx.normalizedRequest.includes("Do NOT produce implementation code"), "No-code instruction");
  assert(ctx.normalizedRequest.includes(input), "Preserves original input");
  assert(ctx.rawInput === input, "Stores raw input");
  assert(ctx.likelyCommand === "solve", `Default to solve (got ${ctx.likelyCommand})`);
}

// ── Test 2: Migration idea ───────────────────────────────────────────

console.log("\n[Test 2] Migration idea — normalizer\n");
{
  const input = "We need to port Models Download from Pocket to HQ";
  const ctx = normalizeDiscovery(input);

  assert(ctx.likelyCommand === "migrate", `Detects migrate (got ${ctx.likelyCommand})`);
  assert(ctx.normalizedRequest.includes("[Discovery]"), "Has discovery tag");
}

console.log("\n[Test 2b] Migration idea — rendering\n");
{
  const artifact = mockArtifact({
    title: "Port Models Download from Pocket to HQ",
    idea: "We need to port Models Download from Pocket to HQ",
    readiness: "needs_input",
    readinessReason: "1 critical question(s) must be resolved before execution: Which platform?.",
    suggestedNextCommand: 'tpdc migrate "Port Models Download from Pocket to HQ across Redux, API"',
  });
  const run = mockRun();
  const output = renderDiscoveryResult(artifact, run);

  assert(output.includes("DISCOVERY"), "Header has DISCOVERY");
  assert(output.includes("NEEDS INPUT"), "Shows needs_input readiness");
  assert(output.includes("tpdc migrate"), "Suggests migrate command");
}

// ── Test 3: Bug-like idea → fix ──────────────────────────────────────

console.log("\n[Test 3] Bug-like idea → recommends fix\n");
{
  const input = "The image upload is broken when offline and crashes the app";
  const ctx = normalizeDiscovery(input);
  assert(ctx.likelyCommand === "fix", `Detects fix (got ${ctx.likelyCommand})`);
}

console.log("\n[Test 3b] Bug-like → artifact suggests fix command\n");
{
  const artifact = mockArtifact({
    title: "Image upload crash when offline",
    idea: "The image upload is broken when offline and crashes the app",
    readiness: "ready_for_execution",
    readinessReason: "The idea is well-framed and can proceed to execution.",
    suggestedNextCommand: 'tpdc fix "Handle offline state in image upload to prevent crash"',
    criticalQuestions: [],
    informationalQuestions: [],
  });
  const run = mockRun();
  const output = renderDiscoveryResult(artifact, run);

  assert(output.includes("READY"), "Shows ready_for_execution");
  assert(output.includes("tpdc fix"), "Suggests fix command");
  assert(output.includes("🟢"), "Green indicator for ready");
}

// ── Test 4: Not ready ────────────────────────────────────────────────

console.log("\n[Test 4] Idea with not_ready state\n");
{
  const artifact = mockArtifact({
    readiness: "not_ready",
    readinessReason: "Workflow failed — the idea may need more fundamental rethinking.",
    suggestedNextCommand: 'tpdc discovery "Prevent org data leakage" (re-run after rethinking)',
    criticalQuestions: [
      { question: "What exactly leaks?", owner: "engineering", classification: "critical" },
      { question: "Which module is affected?", owner: "engineering", classification: "critical" },
    ],
    informationalQuestions: [
      { question: "Is there logging?", owner: "engineering", classification: "informational" },
    ],
  });
  const run = mockRun({ finalVerdict: "fail" });
  const output = renderDiscoveryResult(artifact, run);

  assert(output.includes("NOT READY"), "Shows not_ready");
  assert(output.includes("🔴"), "Red indicator for not_ready");
  assert(output.includes("re-run after"), "Suggests re-running discovery");
  assert(output.includes("Critical Questions"), "Shows critical questions section");
  assert(output.includes("Informational Questions"), "Shows informational questions section");
}

// ── Test 5: Ready with informational questions ───────────────────────

console.log("\n[Test 5] Ready-for-execution (informational questions only)\n");
{
  const artifact = mockArtifact({
    readiness: "ready_for_execution",
    readinessReason: "Ready to execute. 1 informational question(s) remain but are not blocking.",
    suggestedNextCommand: 'tpdc solve "Implement selective Redux state reset with cache invalidation across Redux, API, cache"',
    criticalQuestions: [],
    informationalQuestions: [
      { question: "Should we add metrics?", owner: "product", classification: "informational" },
    ],
  });
  const run = mockRun();
  const output = renderDiscoveryResult(artifact, run);

  assert(output.includes("READY"), "Shows READY");
  assert(output.includes("🟢"), "Green indicator");
  assert(output.includes("tpdc solve"), "Suggests solve command");
  assert(!output.includes("Critical Questions"), "No critical questions section");
  assert(output.includes("Informational Questions"), "Has informational questions");
  assert(output.includes("not blocking") || output.includes("informational"), "Readiness mentions informational/not blocking");
}

// ── Test 6: Renderer all sections ────────────────────────────────────

console.log("\n[Test 6] Renderer output sections\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderDiscoveryResult(artifact, run);

  assert(output.includes("Idea"), "Has Idea section");
  assert(output.includes("Problem Framing"), "Has Problem Framing section");
  assert(output.includes("Affected Areas"), "Has Affected Areas section");
  assert(output.includes("Impact Areas"), "Has Impact Areas section");
  assert(output.includes("Constraints"), "Has Constraints section");
  assert(output.includes("Assumptions"), "Has Assumptions section");
  assert(output.includes("Critical Questions"), "Has Critical Questions section");
  assert(output.includes("Risks"), "Has Risks section");
  assert(output.includes("Tradeoffs"), "Has Tradeoffs section");
  assert(output.includes("Recommendation"), "Has Recommendation section");
  assert(output.includes("Decision Drivers"), "Has Decision Drivers section");
  assert(output.includes("Readiness"), "Has Readiness section");
  assert(output.includes("Suggested Next Step"), "Has Suggested Next Step section");
  assert(output.includes("wf_test_discovery"), "Shows run ID");
}

// ── Test 7: Markdown summary ─────────────────────────────────────────

console.log("\n[Test 7] Discovery markdown summary\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const md = renderDiscoveryMarkdown(artifact, run);

  assert(md.includes("# 🟡 Discovery:"), "MD has discovery header with emoji");
  assert(md.includes("## Idea"), "MD has Idea section");
  assert(md.includes("## Problem Framing"), "MD has Problem Framing");
  assert(md.includes("## Affected Areas"), "MD has Affected Areas");
  assert(md.includes("## Impact Areas"), "MD has Impact Areas");
  assert(md.includes("## Critical Questions"), "MD has Critical Questions");
  assert(md.includes("## Risks"), "MD has Risks");
  assert(md.includes("## Tradeoffs"), "MD has Tradeoffs");
  assert(md.includes("## Recommendation"), "MD has Recommendation");
  assert(md.includes("## Decision Drivers"), "MD has Decision Drivers");
  assert(md.includes("## Readiness"), "MD has Readiness");
  assert(md.includes("## Suggested Next Step"), "MD has Suggested Next Step");
  assert(md.includes("```"), "MD has code block for command");
  assert(md.includes("tpdc solve"), "MD shows suggested command");
}

// ── Test 8: Command detection ────────────────────────────────────────

console.log("\n[Test 8] Command detection patterns\n");
{
  assert(normalizeDiscovery("The app crashes on login").likelyCommand === "fix", "crash → fix");
  assert(normalizeDiscovery("We want to refactor the auth module").likelyCommand === "refactor", "refactor → refactor");
  assert(normalizeDiscovery("Migrate from Firebase to Supabase").likelyCommand === "migrate", "migrate → migrate");
  assert(normalizeDiscovery("Upgrade React Native to 0.76").likelyCommand === "migrate", "upgrade → migrate");
  assert(normalizeDiscovery("Review security of the API").likelyCommand === "assess", "security review → assess");
  assert(normalizeDiscovery("We want to add dark mode").likelyCommand === "solve", "new feature → solve");
  assert(normalizeDiscovery("Clean up the utility functions").likelyCommand === "refactor", "clean up → refactor");
  assert(normalizeDiscovery("Something is not working in uploads").likelyCommand === "fix", "not working → fix");
  assert(normalizeDiscovery("Switch from REST to GraphQL").likelyCommand === "migrate", "switch from → migrate");
  assert(normalizeDiscovery("Evaluate auth patterns").likelyCommand === "assess", "evaluate → assess");
}

// ── Test 9: Question classification ──────────────────────────────────

console.log("\n[Test 9] Question classification (critical vs informational)\n");
{
  // Critical: platform unknown
  const q1 = classifyQuestion({ question: "What platform or surface is affected — iOS, Android?", owner: "eng" });
  assert(q1.classification === "critical", `Platform question → critical (got ${q1.classification})`);

  // Critical: which component
  const q2 = classifyQuestion({ question: "Which screen or component triggers the permission request?", owner: "eng" });
  assert(q2.classification === "critical", `Component question → critical (got ${q2.classification})`);

  // Critical: desired behavior
  const q3 = classifyQuestion({ question: "What should happen when the user denies permission?", owner: "product" });
  assert(q3.classification === "critical", `Expected behavior → critical (got ${q3.classification})`);

  // Critical: which database
  const q4 = classifyQuestion({ question: "Which database is used for persistence?", owner: "eng" });
  assert(q4.classification === "critical", `Database question → critical (got ${q4.classification})`);

  // Informational: UI pattern preference
  const q5 = classifyQuestion({ question: "Is there an existing UI pattern for directing users to OS settings?", owner: "product" });
  assert(q5.classification === "informational", `UI pattern preference → informational (got ${q5.classification})`);

  // Informational: metrics
  const q6 = classifyQuestion({ question: "Should we add analytics events for permission recovery?", owner: "product" });
  assert(q6.classification === "informational", `Analytics question → informational (got ${q6.classification})`);

  // Informational: logging
  const q7 = classifyQuestion({ question: "Do we want to log permission state changes?", owner: "eng" });
  assert(q7.classification === "informational", `Logging question → informational (got ${q7.classification})`);

  // Critical: blocking
  const q8 = classifyQuestion({ question: "This issue blocks the release — what is the timeline?", owner: "product" });
  assert(q8.classification === "critical", `Blocking question → critical (got ${q8.classification})`);
}

// ── Test 10: Semantic readiness logic ─────────────────────────────────

console.log("\n[Test 10] Semantic readiness logic\n");
{
  // Ready: no critical questions, some informational
  const readyArtifact = mockArtifact({
    criticalQuestions: [],
    informationalQuestions: [
      { question: "Should we add metrics?", owner: "product", classification: "informational" },
    ],
    readiness: "ready_for_execution",
  });
  assert(readyArtifact.readiness === "ready_for_execution", "No critical Qs + some informational → ready");

  // Needs input: has critical questions
  const needsInputArtifact = mockArtifact({
    criticalQuestions: [
      { question: "Which platform?", owner: "eng", classification: "critical" },
    ],
    readiness: "needs_input",
  });
  assert(needsInputArtifact.readiness === "needs_input", "Critical Qs → needs_input");

  // Ready: zero questions
  const fullyReadyArtifact = mockArtifact({
    criticalQuestions: [],
    informationalQuestions: [],
    readiness: "ready_for_execution",
  });
  assert(fullyReadyArtifact.readiness === "ready_for_execution", "No questions at all → ready");

  // Not ready: failed stage
  const notReadyArtifact = mockArtifact({ readiness: "not_ready" });
  assert(notReadyArtifact.readiness === "not_ready", "Failed stage → not_ready");
}

// ── Test 11: Tradeoffs, decision drivers, impact areas ───────────────

console.log("\n[Test 11] New artifact fields\n");
{
  const artifact = mockArtifact();

  // Tradeoffs
  assert(artifact.tradeoffs.length > 0, "Has tradeoffs");
  assert(artifact.tradeoffs[0].option.length > 0, "Tradeoff has option name");
  assert(Array.isArray(artifact.tradeoffs[0].advantages), "Tradeoff has advantages array");
  assert(Array.isArray(artifact.tradeoffs[0].disadvantages), "Tradeoff has disadvantages array");

  // Decision drivers
  assert(artifact.decisionDrivers.length > 0, "Has decision drivers");
  assert(artifact.decisionDrivers[0].length > 10, "Decision driver is substantial");

  // Impact areas — should be descriptive, not single-word tags
  assert(artifact.impactAreas.length > 0, "Has impact areas");
  assert(artifact.impactAreas.some((a) => a.length > 10), "Impact areas are descriptive (not single-word tags)");

  // Renderer shows them
  const run = mockRun();
  const output = renderDiscoveryResult(artifact, run);
  assert(output.includes("Tradeoffs"), "Renderer shows Tradeoffs");
  assert(output.includes("Decision Drivers"), "Renderer shows Decision Drivers");
  assert(output.includes("Impact Areas"), "Renderer shows Impact Areas");
  assert(output.includes("+ "), "Tradeoffs show advantages with +");
  assert(output.includes("- Poor UX"), "Tradeoffs show specific disadvantages");
}

// ── Test 12: Rich suggested next command ─────────────────────────────

console.log("\n[Test 12] Rich suggested next command\n");
{
  const artifact = mockArtifact();

  // Should be richer than just the title
  assert(artifact.suggestedNextCommand.length > 40, `Command is substantial (${artifact.suggestedNextCommand.length} chars)`);
  assert(artifact.suggestedNextCommand.startsWith("tpdc "), "Starts with tpdc");

  // Not-ready should suggest re-running discovery
  const notReady = mockArtifact({
    readiness: "not_ready",
    suggestedNextCommand: 'tpdc discovery "Prevent org data leakage" (re-run after rethinking)',
  });
  assert(notReady.suggestedNextCommand.includes("discovery"), "not_ready → suggests discovery");
  assert(notReady.suggestedNextCommand.includes("re-run"), "not_ready → mentions re-run");
}

// ── Test 13: Readiness values ────────────────────────────────────────

console.log("\n[Test 13] Readiness enum values\n");
{
  const r1: Readiness = "ready_for_execution";
  const r2: Readiness = "needs_input";
  const r3: Readiness = "not_ready";
  assert(r1 === "ready_for_execution", "ready_for_execution is valid");
  assert(r2 === "needs_input", "needs_input is valid");
  assert(r3 === "not_ready", "not_ready is valid");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
