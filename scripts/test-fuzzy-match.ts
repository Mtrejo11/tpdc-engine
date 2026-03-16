#!/usr/bin/env npx ts-node

/**
 * Tests for fuzzy hunk relocation and its integration with dry-run + apply.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { relocateHunks, HunkRelocation } from "../src/patch/fuzzyMatch";
import { DiffHunk } from "../src/patch/parseDiff";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { applyPatches, ApplyResult } from "../src/patch/applyPatch";
import { defaultSafetyConfig } from "../src/patch/safetyChecks";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  [OK] ${msg}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${msg}`);
    failed++;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeHunk(oldStart: number, contextLines: string[], addLines: string[] = []): DiffHunk {
  const lines: Array<{ type: "context" | "add" | "remove"; content: string }> = [
    ...contextLines.map((c) => ({ type: "context" as const, content: c })),
    ...addLines.map((a) => ({ type: "add" as const, content: a })),
  ];
  return {
    oldStart,
    oldCount: contextLines.length,
    newStart: oldStart,
    newCount: contextLines.length + addLines.length,
    lines,
  };
}

function makeTempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpdc-fuzzy-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
  return dir;
}

// ── Test 1: Small line offset — exact context relocates ─────────────

function testSmallLineOffset() {
  // File has the target content at line 20, but hunk claims line 10
  const fileLines: string[] = [];
  for (let i = 0; i < 50; i++) fileLines.push(`line ${i + 1}`);
  // Put unique context at lines 20-22 (0-based: 19-21)
  fileLines[19] = "function doStuff() {";
  fileLines[20] = "  const x = 42;";
  fileLines[21] = "  return x;";

  const hunk = makeHunk(10, ["function doStuff() {", "  const x = 42;", "  return x;"]);

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === true, "Small line offset: relocates successfully");
  if (result.ok) {
    assert(result.relocations[0].confidence === "fuzzy", "Small line offset: marked as fuzzy");
    assert(result.relocations[0].relocatedStart === 20, "Small line offset: found correct position (line 20)");
    assert(result.relocations[0].offset === 10, "Small line offset: offset is +10");
  }
}

// ── Test 2: Exact match — no fuzzy needed ───────────────────────────

function testExactMatch() {
  const fileLines = [
    "line 1",
    "function doStuff() {",
    "  const x = 42;",
    "  return x;",
    "line 5",
  ];

  const hunk = makeHunk(2, ["function doStuff() {", "  const x = 42;", "  return x;"]);

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === true, "Exact match: succeeds");
  if (result.ok) {
    assert(result.relocations[0].confidence === "exact", "Exact match: marked as exact");
    assert(result.relocations[0].offset === 0, "Exact match: zero offset");
  }
}

// ── Test 3: Multiple nearby candidates — ambiguous, rejected ────────

function testAmbiguousMatch() {
  const fileLines: string[] = [];
  for (let i = 0; i < 50; i++) fileLines.push(`line ${i + 1}`);
  // Same content at two positions
  fileLines[10] = "  const x = 42;";
  fileLines[11] = "  return x;";
  fileLines[30] = "  const x = 42;";
  fileLines[31] = "  return x;";

  const hunk = makeHunk(5, ["  const x = 42;", "  return x;"]);

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === false, "Ambiguous match: rejected");
  if (!result.ok) {
    assert(result.detail.includes("ambiguous"), "Ambiguous match: detail mentions ambiguous");
    assert(result.detail.includes("2 candidate"), "Ambiguous match: shows 2 candidates");
  }
}

// ── Test 4: No match at all ─────────────────────────────────────────

function testNoMatch() {
  const fileLines = ["line 1", "line 2", "line 3"];

  const hunk = makeHunk(1, ["this content does not exist anywhere"]);

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === false, "No match: rejected");
  if (!result.ok) {
    assert(result.detail.includes("no match found"), "No match: detail mentions no match");
  }
}

// ── Test 5: Large offset (near max radius) ──────────────────────────

function testLargeOffset() {
  const fileLines: string[] = [];
  for (let i = 0; i < 1000; i++) fileLines.push(`line ${i + 1}`);
  // Place unique content at line 800 (0-based: 799)
  fileLines[799] = "unique_marker_abc123";
  fileLines[800] = "second_marker_def456";

  // Hunk claims line 300
  const hunk = makeHunk(300, ["unique_marker_abc123", "second_marker_def456"]);

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === true, "Large offset: relocates within default radius");
  if (result.ok) {
    assert(result.relocations[0].relocatedStart === 800, "Large offset: found at line 800");
    assert(result.relocations[0].offset === 500, "Large offset: offset is +500");
  }
}

// ── Test 6: Beyond max radius — fails ───────────────────────────────

function testBeyondRadius() {
  const fileLines: string[] = [];
  for (let i = 0; i < 2000; i++) fileLines.push(`line ${i + 1}`);
  fileLines[1800] = "unique_far_away";

  const hunk = makeHunk(100, ["unique_far_away"]);

  // Use tight radius
  const result = relocateHunks([hunk], fileLines, { maxSearchRadius: 50 });
  assert(result.ok === false, "Beyond radius: rejected with tight radius");
}

// ── Test 7: Trailing whitespace tolerance ───────────────────────────

function testWhitespaceTolerance() {
  const fileLines = [
    "line 1",
    "  const x = 42;  ", // trailing spaces in file
    "  return x;",
    "line 4",
  ];

  // Hunk context has no trailing spaces but wrong line number
  const hunk = makeHunk(10, ["  const x = 42;", "  return x;"]);

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === true, "Whitespace tolerance: matches despite trailing spaces");
  if (result.ok) {
    assert(result.relocations[0].relocatedStart === 2, "Whitespace tolerance: correct position");
  }
}

// ── Test 8: Multiple hunks, each relocated ──────────────────────────

function testMultipleHunks() {
  const fileLines: string[] = [];
  for (let i = 0; i < 100; i++) fileLines.push(`generic line ${i + 1}`);
  // Unique content at different positions
  fileLines[29] = "MARKER_A_START";
  fileLines[30] = "MARKER_A_END";
  fileLines[69] = "MARKER_B_START";
  fileLines[70] = "MARKER_B_END";

  const hunkA = makeHunk(5, ["MARKER_A_START", "MARKER_A_END"]);
  const hunkB = makeHunk(10, ["MARKER_B_START", "MARKER_B_END"]);

  const result = relocateHunks([hunkA, hunkB], fileLines);
  assert(result.ok === true, "Multiple hunks: both relocate");
  if (result.ok) {
    assert(result.relocations[0].relocatedStart === 30, "Multiple hunks: hunk A at line 30");
    assert(result.relocations[1].relocatedStart === 70, "Multiple hunks: hunk B at line 70");
  }
}

// ── Test 9: Dry-run integration — fuzzy match makes patch applicable ─

function testDryRunIntegration() {
  const fileContent = [
    "line 1",
    "line 2",
    "function hello() {",
    '  console.log("hello");',
    "}",
    "line 6",
  ].join("\n");

  const repoRoot = makeTempRepo({ "src/app.ts": fileContent });

  // Diff claims line 100 but context matches line 3
  const diff = [
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -100,3 +100,3 @@",
    " function hello() {",
    '-  console.log("hello");',
    '+  console.log("world");',
    " }",
  ].join("\n");

  const patches: PatchInput[] = [{
    filePath: "src/app.ts",
    operation: "modify",
    diff,
  }];

  const result = dryRunValidate(patches, defaultSafetyConfig(repoRoot));
  assert(result.applicable === 1, "Dry-run integration: patch is applicable via fuzzy match");
  assert(result.conflicts === 0, "Dry-run integration: no conflicts");

  const check = result.patchChecks[0];
  assert(check.detail.includes("relocated via fuzzy match"), "Dry-run integration: detail mentions fuzzy");
  assert(check.relocations !== undefined, "Dry-run integration: relocations present");
  if (check.relocations) {
    assert(check.relocations[0].confidence === "fuzzy", "Dry-run integration: relocation is fuzzy");
    assert(check.relocations[0].relocatedStart === 3, "Dry-run integration: relocated to line 3");
  }

  // Cleanup
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

// ── Test 10: Apply integration — fuzzy relocated patch applies correctly ─

function testApplyIntegration() {
  const fileContent = [
    "line 1",
    "line 2",
    "function hello() {",
    '  console.log("hello");',
    "}",
    "line 6",
  ].join("\n");

  const repoRoot = makeTempRepo({ "src/app.ts": fileContent });

  const diff = [
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -100,3 +100,3 @@",
    " function hello() {",
    '-  console.log("hello");',
    '+  console.log("world");',
    " }",
  ].join("\n");

  const patches: PatchInput[] = [{
    filePath: "src/app.ts",
    operation: "modify",
    diff,
  }];

  // Dry-run first (needed by apply)
  const dryRunResult = dryRunValidate(patches, defaultSafetyConfig(repoRoot));
  assert(dryRunResult.applicable === 1, "Apply integration: dry-run passes");

  // Apply
  const applyResult = applyPatches(patches, {
    repoRoot,
    confirmed: true,
    dryRunResult,
  });

  assert(applyResult.status === "applied", "Apply integration: status is applied");
  assert(applyResult.filesChanged === 1, "Apply integration: 1 file changed");

  // Verify the content
  const modified = fs.readFileSync(path.join(repoRoot, "src/app.ts"), "utf-8");
  assert(modified.includes('console.log("world")'), "Apply integration: content replaced correctly");
  assert(!modified.includes('console.log("hello")'), "Apply integration: old content removed");
  assert(modified.includes("function hello() {"), "Apply integration: surrounding context preserved");
  assert(modified.includes("line 1"), "Apply integration: unrelated lines untouched");

  // Cleanup
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

// ── Test 11: Malformed diff still rejected ──────────────────────────

function testMalformedDiffRejected() {
  const fileContent = "line 1\nline 2\nline 3\n";
  const repoRoot = makeTempRepo({ "src/app.ts": fileContent });

  const patches: PatchInput[] = [{
    filePath: "src/app.ts",
    operation: "modify",
    diff: "this is not a valid diff at all",
  }];

  const result = dryRunValidate(patches, defaultSafetyConfig(repoRoot));
  assert(result.patchChecks[0].status === "malformed_diff", "Malformed diff: still rejected by parser");
  assert(result.applicable === 0, "Malformed diff: not applicable");

  fs.rmSync(repoRoot, { recursive: true, force: true });
}

// ── Test 12: Pure addition hunk (no context) — accepted at face value ─

function testPureAddition() {
  const fileLines = ["line 1", "line 2", "line 3"];

  const hunk: DiffHunk = {
    oldStart: 2,
    oldCount: 0,
    newStart: 2,
    newCount: 2,
    lines: [
      { type: "add", content: "new line A" },
      { type: "add", content: "new line B" },
    ],
  };

  const result = relocateHunks([hunk], fileLines);
  assert(result.ok === true, "Pure addition: accepted");
  if (result.ok) {
    assert(result.relocations[0].confidence === "exact", "Pure addition: confidence is exact (no relocation needed)");
  }
}

// ── Run ─────────────────────────────────────────────────────────────

console.log("[Fuzzy Match Tests] Running 12 tests\n");

testSmallLineOffset();
testExactMatch();
testAmbiguousMatch();
testNoMatch();
testLargeOffset();
testBeyondRadius();
testWhitespaceTolerance();
testMultipleHunks();
testDryRunIntegration();
testApplyIntegration();
testMalformedDiffRejected();
testPureAddition();

console.log(`\n  ${"─".repeat(41)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
