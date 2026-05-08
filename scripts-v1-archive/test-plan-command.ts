/**
 * Tests for the `tpdc plan` technical planning flow.
 *
 * Tests:
 * 1. Feature planning — normalizer + artifact + renderer
 * 2. Migration-style planning
 * 3. Blocked planning due to missing context
 * 4. Ready-to-execute plan
 * 5. Command detection
 * 6. Renderer output structure
 * 7. Markdown summary
 * 8. Phases with dependencies
 * 9. Validation approach
 */

import { normalizePlan, PlanContext } from "../src/plugin/handlers/planNormalizer";
import { PlanSummaryArtifact, PlanPhase } from "../src/plugin/handlers/planArtifact";
import { renderPlanResult, renderPlanMarkdown } from "../src/plugin/renderers/planRenderer";
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
    workflowId: "wf_test_plan",
    timestamp: "2026-03-15T00:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 110000,
    summary: "Plan completed.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 20000 },
      { capabilityId: "design", status: "passed", durationMs: 30000 },
      { capabilityId: "decompose", status: "passed", durationMs: 25000 },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 20000 },
    ],
    score: 80,
    artifactPaths: [],
    ...overrides,
  };
}

function mockArtifact(overrides: Partial<PlanSummaryArtifact> = {}): PlanSummaryArtifact {
  return {
    title: "Implement tenant reset on logout in Field Lite",
    request: "Implement tenant reset on logout in Field Lite",
    objective: "Ensure all org-scoped state is cleared when a user logs out or switches organizations, preventing cross-tenant data leakage.",
    scope: [
      "Redux store reset on logout/org-switch",
      "AsyncStorage and SQLite cache clearing",
      "Firebase session teardown",
    ],
    assumptions: [
      "Users log out infrequently",
      "SQLite DB is org-scoped and can be dropped on switch",
    ],
    openQuestions: [
      { question: "Are there background sync jobs that must be cancelled on logout?", owner: "engineering" },
    ],
    risks: [
      { risk: "Incomplete state reset leaves org A data visible in org B", mitigation: "Full Redux store reset on org switch" },
      { risk: "Background sync writes stale data after logout", mitigation: "Cancel all pending sync jobs before clearing state" },
    ],
    affectedAreas: [
      "Redux store reset on logout/org-switch",
      "AsyncStorage and SQLite cache clearing",
      "Firebase session teardown",
    ],
    likelyFiles: [
      "src/store/shared/application.reducer.ts",
      "src/services/AuthService.ts",
      "src/services/SQLiteDBService/databaseContext.ts",
    ],
    phases: [
      {
        stepNumber: 1,
        title: "Audit current logout flow",
        goal: "Map all state stores, caches, and sessions that hold org-scoped data.",
        files: [],
        dependsOn: [],
      },
      {
        stepNumber: 2,
        title: "Implement Redux store reset",
        goal: "Clear all org-scoped Redux slices on logout/org-switch dispatch.",
        files: ["src/store/shared/application.reducer.ts"],
        dependsOn: [1],
      },
      {
        stepNumber: 3,
        title: "Clear AsyncStorage and SQLite caches",
        goal: "Drop org-scoped SQLite tables and clear AsyncStorage keys on logout.",
        files: ["src/services/SQLiteDBService/databaseContext.ts"],
        dependsOn: [1],
      },
      {
        stepNumber: 4,
        title: "Teardown Firebase session",
        goal: "Sign out of Firebase Auth and clear Firestore listeners.",
        files: ["src/services/AuthService.ts"],
        dependsOn: [2, 3],
      },
    ],
    dependencies: [
      "Step 2 (Implement Redux store reset) depends on: Audit current logout flow",
      "Step 3 (Clear AsyncStorage and SQLite caches) depends on: Audit current logout flow",
      "Step 4 (Teardown Firebase session) depends on: Implement Redux store reset, Clear AsyncStorage and SQLite caches",
    ],
    validationApproach: [
      "Log in as org A, create data, switch to org B — verify no org A data visible",
      "Log out and log back in — verify no stale state from previous session",
      "Verify background sync jobs are cancelled before state clearing",
    ],
    readiness: "ready_to_execute",
    readinessReason: "Plan is actionable with 4 phase(s) and no blocking questions.",
    suggestedNextCommand: 'tpdc solve "Ensure all org-scoped state is cleared when a user logs out or switches organizations, preventing cross-tenant data leakage"',
    ...overrides,
  };
}

// ── Test 1: Feature planning ─────────────────────────────────────────

console.log("\n[Test 1] Feature planning — normalizer\n");
{
  const input = "Implement tenant reset on logout in Field Lite";
  const ctx = normalizePlan(input);

  assert(ctx.normalizedRequest.includes("[Plan]"), "Has [Plan] tag");
  assert(ctx.normalizedRequest.includes("Do NOT generate code, patches, or mutations"), "No-mutation instruction");
  assert(ctx.normalizedRequest.includes("ordered implementation phases"), "Mentions phases");
  assert(ctx.normalizedRequest.includes(input), "Preserves original input");
  assert(ctx.likelyCommand === "solve", `Default to solve (got ${ctx.likelyCommand})`);
  assert(ctx.rawInput === input, "Stores raw input");
}

console.log("\n[Test 1b] Feature planning — rendering\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  assert(output.includes("PLAN"), "Has PLAN header");
  assert(output.includes("READY"), "Shows ready status");
  assert(output.includes("tenant reset"), "Shows title");
  assert(output.includes("Objective"), "Has Objective section");
  assert(output.includes("Scope"), "Has Scope section");
  assert(output.includes("Phases (4)"), "Shows 4 phases");
  assert(output.includes("Audit current logout"), "Shows first phase");
  assert(output.includes("Validation Approach"), "Has validation section");
  assert(output.includes("tpdc solve"), "Suggests solve command");
}

// ── Test 2: Migration-style planning ─────────────────────────────────

console.log("\n[Test 2] Migration planning — normalizer\n");
{
  const input = "Port Models Download from Pocket to HQ";
  const ctx = normalizePlan(input);

  assert(ctx.likelyCommand === "migrate", `Detects migrate (got ${ctx.likelyCommand})`);
  assert(ctx.normalizedRequest.includes("[Plan]"), "Has plan tag");
}

console.log("\n[Test 2b] Migration planning — rendering\n");
{
  const artifact = mockArtifact({
    title: "Port Models Download from Pocket to HQ",
    request: "Port Models Download from Pocket to HQ",
    objective: "Migrate the model download and management system from the Pocket mobile app to the HQ web platform.",
    phases: [
      { stepNumber: 1, title: "Map Pocket model download API surface", goal: "Document all endpoints and data contracts.", files: [], dependsOn: [] },
      { stepNumber: 2, title: "Design HQ model management UI", goal: "Create wireframes for the HQ download interface.", files: [], dependsOn: [1] },
      { stepNumber: 3, title: "Implement HQ download service", goal: "Port download logic to HQ backend.", files: ["src/services/ModelDownloadService.ts"], dependsOn: [1] },
    ],
    suggestedNextCommand: 'tpdc migrate "Migrate the model download and management system from Pocket to HQ"',
  });
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  assert(output.includes("tpdc migrate"), "Suggests migrate command");
  assert(output.includes("Phases (3)"), "Shows 3 phases");
  assert(output.includes("after step 1"), "Shows dependency on step 1");
}

// ── Test 3: Blocked planning ─────────────────────────────────────────

console.log("\n[Test 3] Blocked planning — missing context\n");
{
  const artifact = mockArtifact({
    title: "Add real-time notifications",
    phases: [],
    likelyFiles: [],
    readiness: "blocked",
    readinessReason: "Plan blocked: The notification delivery mechanism (push, WebSocket, SSE) has not been decided.",
    suggestedNextCommand: 'tpdc plan "Add real-time notifications" (re-run after resolving blockers)',
    openQuestions: [
      { question: "Which notification delivery mechanism should be used?", owner: "engineering" },
      { question: "What platform are notifications needed on?", owner: "product" },
    ],
  });
  const run = mockRun({
    finalVerdict: "blocked",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 20000 },
      { capabilityId: "design", status: "passed", durationMs: 30000 },
      { capabilityId: "decompose", status: "blocked", durationMs: 10000, blockReason: "Notification mechanism not decided" },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 20000 },
    ],
  });
  const output = renderPlanResult(run, artifact);

  assert(output.includes("BLOCKED"), "Shows BLOCKED status");
  assert(output.includes("🔴"), "Red indicator");
  assert(output.includes("re-run after resolving"), "Suggests re-running");
  assert(output.includes("Open Questions"), "Shows open questions");
  assert(output.includes("notification delivery"), "Shows blocking reason");
  assert(!output.includes("Phases"), "No phases section when blocked");
}

// ── Test 4: Ready-to-execute plan ────────────────────────────────────

console.log("\n[Test 4] Ready-to-execute plan\n");
{
  const artifact = mockArtifact({
    openQuestions: [],
    readiness: "ready_to_execute",
    readinessReason: "Plan is actionable with 4 phase(s) and no blocking questions.",
  });
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  assert(output.includes("🟢 READY"), "Green ready indicator");
  assert(output.includes("actionable"), "Readiness mentions actionable");
  assert(!output.includes("Open Questions"), "No open questions");
  assert(output.includes("tpdc solve"), "Suggests solve");
}

// ── Test 5: Command detection ────────────────────────────────────────

console.log("\n[Test 5] Command detection patterns\n");
{
  assert(normalizePlan("Fix the broken image upload").likelyCommand === "fix", "fix → fix");
  assert(normalizePlan("Migrate auth to Supabase").likelyCommand === "migrate", "migrate → migrate");
  assert(normalizePlan("Refactor the upload service").likelyCommand === "refactor", "refactor → refactor");
  assert(normalizePlan("Split PlantViewModal into components").likelyCommand === "refactor", "split → refactor");
  assert(normalizePlan("Add dark mode support").likelyCommand === "solve", "new feature → solve");
  assert(normalizePlan("Implement push notifications").likelyCommand === "solve", "implement → solve");
  assert(normalizePlan("Upgrade React Native to 0.76").likelyCommand === "migrate", "upgrade → migrate");
  assert(normalizePlan("Port the download module").likelyCommand === "migrate", "port → migrate");
}

// ── Test 6: Renderer output structure ────────────────────────────────

console.log("\n[Test 6] Renderer output sections\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  assert(output.includes("Plan Summary"), "Has Plan Summary");
  assert(output.includes("Objective"), "Has Objective");
  assert(output.includes("Scope"), "Has Scope");
  assert(output.includes("Likely Files"), "Has Likely Files");
  assert(output.includes("Assumptions"), "Has Assumptions");
  assert(output.includes("Risks"), "Has Risks");
  assert(output.includes("Phases"), "Has Phases");
  assert(output.includes("Dependencies"), "Has Dependencies");
  assert(output.includes("Validation Approach"), "Has Validation Approach");
  assert(output.includes("Readiness"), "Has Readiness");
  assert(output.includes("Suggested Next Step"), "Has Suggested Next Step");
  assert(output.includes("wf_test_plan"), "Shows run ID");
  assert(output.includes("80/100"), "Shows score");
}

// ── Test 7: Markdown summary ─────────────────────────────────────────

console.log("\n[Test 7] Markdown summary\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const md = renderPlanMarkdown(artifact, run);

  assert(md.includes("# 🟢 Plan:"), "MD header with emoji");
  assert(md.includes("## Objective"), "MD Objective");
  assert(md.includes("## Scope"), "MD Scope");
  assert(md.includes("## Likely Files"), "MD Likely Files");
  assert(md.includes("## Assumptions"), "MD Assumptions");
  assert(md.includes("## Risks"), "MD Risks");
  assert(md.includes("## Implementation Phases"), "MD Phases");
  assert(md.includes("### Phase 1:"), "MD Phase 1 header");
  assert(md.includes("### Phase 4:"), "MD Phase 4 header");
  assert(md.includes("*(depends on step"), "MD shows dependencies in phases");
  assert(md.includes("## Dependencies"), "MD Dependencies");
  assert(md.includes("## Validation Approach"), "MD Validation");
  assert(md.includes("- [ ]"), "MD validation as checklist");
  assert(md.includes("## Readiness"), "MD Readiness");
  assert(md.includes("## Suggested Next Step"), "MD Next Step");
  assert(md.includes("```"), "MD code block");
  assert(md.includes("tpdc solve"), "MD suggested command");
}

// ── Test 8: Phases with dependencies ─────────────────────────────────

console.log("\n[Test 8] Phases with dependencies\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  // Phase 1 has no deps
  assert(output.includes("1. Audit current logout"), "Phase 1 shown");
  // Phase 2 depends on 1
  assert(output.includes("2. Implement Redux store reset"), "Phase 2 shown");
  assert(output.includes("[after step 1]"), "Phase 2 shows dependency");
  // Phase 4 depends on 2, 3
  assert(output.includes("4. Teardown Firebase session"), "Phase 4 shown");
  assert(output.includes("[after step 2, 3]"), "Phase 4 shows multi-dependency");
  // Phase files
  assert(output.includes("application.reducer.ts"), "Phase 2 shows files");
}

// ── Test 9: Validation approach ──────────────────────────────────────

console.log("\n[Test 9] Validation approach rendering\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  assert(output.includes("Validation Approach"), "Has validation section");
  assert(output.includes("☐"), "Validation items have checkbox");
  assert(output.includes("org A"), "Shows org-switch validation");
  assert(output.includes("background sync"), "Shows sync validation");
}

// ── Test 10: Needs input readiness ───────────────────────────────────

console.log("\n[Test 10] Needs input readiness\n");
{
  const artifact = mockArtifact({
    readiness: "needs_input",
    readinessReason: "2 question(s) should be resolved before executing: Which platform?; What database?.",
    openQuestions: [
      { question: "Which platform is affected?", owner: "engineering" },
      { question: "What database is used?", owner: "engineering" },
    ],
  });
  const run = mockRun();
  const output = renderPlanResult(run, artifact);

  assert(output.includes("NEEDS INPUT"), "Shows needs_input");
  assert(output.includes("🟡"), "Yellow indicator");
  assert(output.includes("Open Questions"), "Shows questions");
}

// ── Test 11: No-mutation enforcement ─────────────────────────────────

console.log("\n[Test 11] No-mutation enforcement\n");
{
  const ctx = normalizePlan("Add feature X");
  assert(!ctx.normalizedRequest.includes("--apply"), "No apply flag");
  assert(ctx.normalizedRequest.includes("Do NOT generate code"), "No-code instruction");
  assert(ctx.normalizedRequest.includes("patches"), "Mentions no patches");
  assert(ctx.normalizedRequest.includes("mutations"), "Mentions no mutations");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
