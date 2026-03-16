/**
 * Tests for the self-learning loop.
 *
 * Tests:
 * 1. Lesson extraction from blocked run
 * 2. Lesson extraction from successful run
 * 3. Lesson extraction from mutation failure
 * 4. Aggregation behavior (dedup + increment)
 * 5. Lesson querying by command + tags
 * 6. Lesson injection into request
 * 7. End-to-end: prior lessons influence future run context
 */

import { extractLearnings } from "../src/learning/extract";
import { loadLessonStore, saveLessonStore, aggregateLearning, queryLessons } from "../src/learning/store";
import { injectLessons } from "../src/learning/inject";
import { LearningArtifact, LessonStore } from "../src/learning/types";
import { RunSummary } from "../src/storage/runs";
import * as fs from "fs";
import * as path from "path";

const MEMORY_DIR = path.resolve(__dirname, "../memory");
const STORE_PATH = path.join(MEMORY_DIR, "lessons.json");

let passed = 0;
let failed = 0;

// Backup + restore to avoid polluting real store
let originalStore: string | null = null;

function setup() {
  if (fs.existsSync(STORE_PATH)) {
    originalStore = fs.readFileSync(STORE_PATH, "utf-8");
  }
  // Start with empty store
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  saveLessonStore({ version: 1, lastUpdated: new Date().toISOString(), lessons: [] });
}

function teardown() {
  if (originalStore !== null) {
    fs.writeFileSync(STORE_PATH, originalStore, "utf-8");
  } else if (fs.existsSync(STORE_PATH)) {
    fs.unlinkSync(STORE_PATH);
  }
}

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
    workflowId: "wf_test_learning",
    timestamp: "2026-03-15T10:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 90000,
    summary: "Test completed.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 15000 },
      { capabilityId: "design", status: "passed", durationMs: 25000 },
      { capabilityId: "decompose", status: "passed", durationMs: 20000 },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 15000 },
    ],
    score: 80,
    artifactPaths: [],
    ...overrides,
  };
}

// ── Run tests ────────────────────────────────────────────────────────

setup();

try {

// ── Test 1: Extract from blocked run ─────────────────────────────────

console.log("\n[Test 1] Lesson extraction from blocked run\n");
{
  const run = mockRun({
    workflowId: "wf_blocked_001",
    finalVerdict: "blocked",
    blockReason: "The affected platform is unknown — iOS or Android not specified",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 15000 },
      { capabilityId: "design", status: "passed", durationMs: 25000 },
      { capabilityId: "decompose", status: "blocked", durationMs: 5000, blockReason: "Platform unknown" },
      { capabilityId: "execute", status: "skipped", durationMs: 0 },
      { capabilityId: "validate", status: "skipped", durationMs: 0 },
    ],
  });

  const learning = extractLearnings(run, "fix");

  assert(learning.runId === "wf_blocked_001", "Captures runId");
  assert(learning.command === "fix", "Captures command");
  assert(learning.outcome === "blocked", "Captures outcome");
  assert(learning.failurePatterns.includes("missing_platform"), "Detects missing_platform pattern");
  assert(learning.suggestedHeuristics.length > 0, "Produces heuristics");
  assert(learning.suggestedHeuristics.some((h) => h.includes("platform")), "Heuristic mentions platform");
  assert(learning.lessons.length > 0, "Has lessons");
  assert(learning.tags.includes("fix"), "Tagged with command");
  assert(learning.tags.includes("blocked"), "Tagged with outcome");
  assert(learning.tags.includes("platform"), "Tagged with platform");
}

// ── Test 2: Extract from successful run ──────────────────────────────

console.log("\n[Test 2] Lesson extraction from successful run\n");
{
  const run = mockRun({
    workflowId: "wf_success_001",
    finalVerdict: "pass",
    score: 85,
  });

  const learning = extractLearnings(run, "solve");

  assert(learning.outcome === "pass", "Captures pass outcome");
  assert(learning.successPatterns.includes("solve_pass"), "Has solve_pass pattern");
  assert(learning.successPatterns.includes("high_score"), "Has high_score pattern");
  assert(learning.failurePatterns.length === 0, "No failure patterns");
  assert(learning.tags.includes("pass"), "Tagged with pass");
  assert(learning.tags.includes("high_quality"), "Tagged with high_quality");
}

// ── Test 3: Extract from mutation failure ─────────────────────────────

console.log("\n[Test 3] Lesson extraction from mutation failure\n");
{
  const run = mockRun({
    workflowId: "wf_mutation_fail",
    executionMode: "mutation",
    finalVerdict: "fail",
    score: 42,
    findings: [
      { category: "patch_grounding", severity: "critical", description: "Patch context lines did not match file" },
      { category: "apply_integrity", severity: "major", description: "Hunk could not be applied" },
    ],
    mutation: {
      applied: false,
      branchName: "",
      commitHash: "",
      filesChanged: [],
      patchGenerated: true,
      dryRunPassed: false,
      confirmationSource: "none",
      rollbackTriggered: true,
      errors: ["Apply failed: all patches conflicted"],
    },
  });

  const learning = extractLearnings(run, "fix");

  assert(learning.failurePatterns.includes("patch_grounding_failure"), "Detects patch grounding failure");
  assert(learning.failurePatterns.includes("apply_integrity_failure"), "Detects apply integrity failure");
  assert(learning.failurePatterns.includes("rollback_triggered"), "Detects rollback");
  assert(learning.failurePatterns.includes("low_score"), "Detects low score");
  assert(learning.failurePatterns.includes("mutation_error"), "Detects mutation error");
  assert(learning.suggestedHeuristics.some((h) => h.includes("context lines")), "Heuristic about context lines");
  assert(learning.suggestedHeuristics.some((h) => h.includes("fuzzy")), "Heuristic about fuzzy matching");
}

// ── Test 4: Aggregation ──────────────────────────────────────────────

console.log("\n[Test 4] Aggregation behavior\n");
{
  // First learning
  const learning1: LearningArtifact = {
    runId: "wf_agg_001",
    command: "fix",
    mode: "safe",
    outcome: "blocked",
    lessons: ["Blocked: Platform unknown"],
    failurePatterns: ["missing_platform"],
    successPatterns: [],
    suggestedHeuristics: ["Specify the target platform"],
    tags: ["fix", "blocked", "platform"],
    timestamp: "2026-03-15T10:00:00Z",
  };

  aggregateLearning(learning1);
  let store = loadLessonStore();
  assert(store.lessons.length > 0, "Store has lessons after first aggregate");

  const platformLesson = store.lessons.find((l) => l.pattern === "missing_platform");
  assert(platformLesson !== undefined, "missing_platform lesson exists");
  assert(platformLesson!.occurrences === 1, `First occurrence (got ${platformLesson!.occurrences})`);

  // Second learning with same pattern
  const learning2: LearningArtifact = {
    ...learning1,
    runId: "wf_agg_002",
    timestamp: "2026-03-15T11:00:00Z",
  };
  aggregateLearning(learning2);
  store = loadLessonStore();

  const updated = store.lessons.find((l) => l.pattern === "missing_platform");
  assert(updated!.occurrences === 2, `Second occurrence incremented (got ${updated!.occurrences})`);
  assert(updated!.lastSeen === "2026-03-15T11:00:00Z", "lastSeen updated");

  // Third learning with different command but same pattern
  const learning3: LearningArtifact = {
    ...learning1,
    runId: "wf_agg_003",
    command: "solve",
    timestamp: "2026-03-15T12:00:00Z",
  };
  aggregateLearning(learning3);
  store = loadLessonStore();

  const multi = store.lessons.find((l) => l.pattern === "missing_platform");
  assert(multi!.occurrences === 3, `Third occurrence (got ${multi!.occurrences})`);
  assert(multi!.commands.includes("fix"), "Commands includes fix");
  assert(multi!.commands.includes("solve"), "Commands includes solve");
}

// ── Test 5: Querying ─────────────────────────────────────────────────

console.log("\n[Test 5] Lesson querying\n");
{
  // Store already has data from test 4
  const fixLessons = queryLessons("fix");
  assert(fixLessons.length > 0, "Fix query returns lessons");
  assert(fixLessons.some((l) => l.pattern === "missing_platform"), "Fix query includes missing_platform");

  const solveLessons = queryLessons("solve");
  assert(solveLessons.length > 0, "Solve query returns lessons");

  // Query with tags
  const platformLessons = queryLessons("fix", ["platform"]);
  assert(platformLessons.length > 0, "Tag query returns lessons");
  assert(platformLessons.some((l) => l.pattern === "missing_platform"), "Tag query includes missing_platform");

  // Query with no matches
  const noMatch = queryLessons("assess", ["nonexistent_tag"]);
  // Should still return heuristics (they get score +1)
  // But may return nothing if no heuristics matched
  assert(Array.isArray(noMatch), "No-match returns array");
}

// ── Test 6: Injection ────────────────────────────────────────────────

console.log("\n[Test 6] Lesson injection into request\n");
{
  const original = "Fix camera permission on Android";
  const augmented = injectLessons(original, "fix", ["platform"]);

  assert(augmented.includes(original), "Preserves original request");
  assert(augmented.includes("Prior learnings"), "Includes prior learnings header");
  assert(augmented.includes("Context from prior TPDC runs"), "Includes context header");
  assert(augmented.length > original.length, "Augmented is longer than original");

  // Without relevant lessons
  saveLessonStore({ version: 1, lastUpdated: new Date().toISOString(), lessons: [] });
  const notAugmented = injectLessons(original, "fix");
  assert(notAugmented === original, "No augmentation when no lessons");
}

// ── Test 7: End-to-end pattern influence ─────────────────────────────

console.log("\n[Test 7] Prior lessons influence future run context\n");
{
  // Simulate: two prior runs blocked on missing platform
  saveLessonStore({ version: 1, lastUpdated: new Date().toISOString(), lessons: [] });

  for (let i = 0; i < 3; i++) {
    aggregateLearning({
      runId: `wf_e2e_${i}`,
      command: "fix",
      mode: "safe",
      outcome: "blocked",
      lessons: [`Blocked: Platform unknown (run ${i})`],
      failurePatterns: ["missing_platform"],
      successPatterns: [],
      suggestedHeuristics: ["Requests involving mobile features should specify the target platform (iOS/Android/both)"],
      tags: ["fix", "blocked", "platform"],
      timestamp: new Date().toISOString(),
    });
  }

  // Now a new fix request comes in
  const newRequest = "Camera permission broken after denial";
  const augmented = injectLessons(newRequest, "fix");

  assert(augmented.includes("Prior learnings"), "Injects prior learnings");
  assert(augmented.includes("platform"), "Mentions platform in context");
  assert(augmented.includes("3x"), "Shows occurrence count (3x)");
  assert(augmented.includes("Camera permission"), "Original request preserved");

  // The augmented request would flow into the workflow as-is,
  // providing the LLM with context about common blockers
  assert(augmented.indexOf("Context from prior") < augmented.indexOf("Camera permission"),
    "Lessons appear before the original request");
}

// ── Test 8: Store bounds ─────────────────────────────────────────────

console.log("\n[Test 8] Store stays bounded\n");
{
  saveLessonStore({ version: 1, lastUpdated: new Date().toISOString(), lessons: [] });

  // Add many distinct patterns
  for (let i = 0; i < 120; i++) {
    aggregateLearning({
      runId: `wf_bound_${i}`,
      command: "solve",
      mode: "safe",
      outcome: "pass",
      lessons: [],
      failurePatterns: [`pattern_${i}`],
      successPatterns: [],
      suggestedHeuristics: [],
      tags: ["solve"],
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
    });
  }

  const store = loadLessonStore();
  assert(store.lessons.length <= 100, `Store bounded to 100 (got ${store.lessons.length})`);
}

} finally {
  teardown();
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
