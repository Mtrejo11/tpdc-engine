/**
 * Tests for the `tpdc:develop` orchestrator command.
 *
 * Tests:
 * 1. Parser — develop subcommand parsing
 * 2. Feature flow — ready path (mocked)
 * 3. Feature flow — blocked at discovery
 * 4. Bug flow — blocked for missing context
 * 5. Bug flow — successful path
 * 6. Refactor flow — successful path
 * 7. Declined confirmation path
 * 8. Renderer output structure
 * 9. Develop artifact structure
 * 10. Invalid develop mode
 */

import { parseDevelopArgs, ParsedDevelop, parseInvocation } from "../src/integration/parser";
import { DevelopSummaryArtifact, DevelopStep, renderDevelopResult } from "../src/integration/develop";

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

function mockArtifact(overrides: Partial<DevelopSummaryArtifact> = {}): DevelopSummaryArtifact {
  return {
    mode: "feature",
    request: "Implement tenant reset on logout",
    stages: [
      { name: "Discovery", command: "discovery", status: "passed", workflowId: "wf_disc_001", output: "..." },
      { name: "Plan", command: "plan", status: "passed", workflowId: "wf_plan_001", score: 80, output: "..." },
      { name: "Solve", command: "solve", status: "passed", workflowId: "wf_solve_001", verdict: "pass", score: 85, output: "..." },
    ],
    finalStatus: "completed",
    runIds: ["wf_disc_001", "wf_plan_001", "wf_solve_001"],
    applyResult: {
      applied: true,
      branchName: "tpdc/run-20260315-abc12345",
      commitHash: "abc123def456",
      filesChanged: ["src/store/auth.reducer.ts", "src/services/AuthService.ts"],
    },
    validationResult: {
      verdict: "pass",
      score: 85,
    },
    ...overrides,
  };
}

// ── Test 1: Parser — develop subcommand ──────────────────────────────

console.log("\n[Test 1] Parser — develop subcommand\n");
{
  // Feature
  const feature = parseDevelopArgs('feature "Implement tenant reset on logout"');
  assert(feature !== null, "Parses feature mode");
  assert(feature!.mode === "feature", `Mode is feature (got ${feature!.mode})`);
  assert(feature!.request === "Implement tenant reset on logout", "Extracts request");

  // Bug
  const bug = parseDevelopArgs('bug "Camera permission locked after denial"');
  assert(bug !== null, "Parses bug mode");
  assert(bug!.mode === "bug", "Mode is bug");
  assert(bug!.request.includes("Camera"), "Request preserved");

  // Refactor
  const refactor = parseDevelopArgs('refactor "Split PlantViewModal"');
  assert(refactor !== null, "Parses refactor mode");
  assert(refactor!.mode === "refactor", "Mode is refactor");

  // With flags
  const withFlags = parseDevelopArgs('feature "Do something" --apply --repo-root /path');
  assert(withFlags !== null, "Parses with flags");
  assert(withFlags!.flags.apply === true, "apply flag extracted");
  assert(withFlags!.flags.repoRoot === "/path", "repoRoot extracted");
  assert(withFlags!.request === "Do something", "Request cleaned of flags");

  // Invalid
  assert(parseDevelopArgs("unknown something") === null, "Rejects unknown mode");
  assert(parseDevelopArgs("") === null, "Rejects empty");
  assert(parseDevelopArgs("feature") === null, "Rejects mode without request");

  // Through main parser
  const fullParse = parseInvocation('tpdc:develop feature "Add dark mode"');
  assert(fullParse !== null, "Main parser recognizes develop");
  assert(fullParse!.command === "develop", "Command is develop");
  assert(fullParse!.args.includes("feature"), "Args include mode");
  assert(fullParse!.args.includes("dark mode"), "Args include request");
}

// ── Test 2: Feature flow — completed ─────────────────────────────────

console.log("\n[Test 2] Feature flow — completed artifact\n");
{
  const artifact = mockArtifact();

  assert(artifact.mode === "feature", "Mode is feature");
  assert(artifact.stages.length === 3, "Has 3 stages");
  assert(artifact.stages[0].name === "Discovery", "Step 1 is Discovery");
  assert(artifact.stages[1].name === "Plan", "Step 2 is Plan");
  assert(artifact.stages[2].name === "Solve", "Step 3 is Solve");
  assert(artifact.finalStatus === "completed", "Final status is completed");
  assert(artifact.runIds.length === 3, "Has 3 runIds");
  assert(artifact.applyResult?.applied === true, "Apply result shows applied");
  assert(artifact.validationResult?.score === 85, "Validation score is 85");
}

// ── Test 3: Feature flow — blocked at discovery ──────────────────────

console.log("\n[Test 3] Feature flow — blocked at discovery\n");
{
  const artifact = mockArtifact({
    stages: [
      {
        name: "Discovery",
        command: "discovery",
        status: "blocked",
        workflowId: "wf_disc_002",
        output: "...",
        blockReason: "2 critical questions must be resolved: Which platform?; Which module?",
      },
    ],
    finalStatus: "blocked",
    runIds: ["wf_disc_002"],
    applyResult: undefined,
    validationResult: undefined,
  });

  assert(artifact.finalStatus === "blocked", "Status is blocked");
  assert(artifact.stages.length === 1, "Only 1 stage ran");
  assert(artifact.stages[0].status === "blocked", "Discovery is blocked");
  assert(artifact.stages[0].blockReason!.includes("critical questions"), "Block reason present");

  const output = renderDevelopResult(artifact);
  assert(output.includes("BLOCKED"), "Renderer shows BLOCKED");
  assert(output.includes("Blocked at: Discovery"), "Shows which step blocked");
  assert(output.includes("critical questions"), "Shows block reason");
  assert(!output.includes("Apply Result"), "No apply result when blocked");
}

// ── Test 4: Bug flow — blocked for missing context ───────────────────

console.log("\n[Test 4] Bug flow — blocked for missing context\n");
{
  const artifact = mockArtifact({
    mode: "bug",
    request: "Camera permission locked",
    stages: [
      {
        name: "Fix",
        command: "fix",
        status: "blocked",
        workflowId: "wf_fix_001",
        verdict: "blocked",
        output: "...",
        blockReason: "Platform unknown — cannot determine correct permission API",
      },
    ],
    finalStatus: "blocked",
    runIds: ["wf_fix_001"],
    applyResult: undefined,
    validationResult: undefined,
  });

  const output = renderDevelopResult(artifact);
  assert(output.includes("DEVELOP BUG"), "Shows BUG mode");
  assert(output.includes("BLOCKED"), "Shows blocked");
  assert(output.includes("Blocked at: Fix"), "Blocked at Fix step");
  assert(output.includes("Platform unknown"), "Shows missing context");
}

// ── Test 5: Bug flow — successful ────────────────────────────────────

console.log("\n[Test 5] Bug flow — successful\n");
{
  const artifact = mockArtifact({
    mode: "bug",
    request: "Camera permission locked on Android in roomCamera",
    stages: [
      {
        name: "Fix",
        command: "fix",
        status: "passed",
        workflowId: "wf_fix_002",
        verdict: "pass",
        score: 78,
        output: "...",
      },
    ],
    finalStatus: "completed",
    runIds: ["wf_fix_002"],
    applyResult: {
      applied: true,
      branchName: "tpdc/fix-camera-perm",
      commitHash: "def456abc789",
      filesChanged: ["src/components/Room/roomCamera/roomCamera.component.tsx"],
    },
    validationResult: { verdict: "pass", score: 78 },
  });

  const output = renderDevelopResult(artifact);
  assert(output.includes("DEVELOP BUG"), "Shows BUG mode");
  assert(output.includes("COMPLETED"), "Shows completed");
  assert(output.includes("Apply Result"), "Has apply result");
  assert(output.includes("Applied: yes"), "Shows applied");
  assert(output.includes("tpdc/fix-camera-perm"), "Shows branch");
  assert(output.includes("Validation"), "Has validation");
  assert(output.includes("78/100"), "Shows score");
}

// ── Test 6: Refactor flow — successful ───────────────────────────────

console.log("\n[Test 6] Refactor flow — successful\n");
{
  const artifact = mockArtifact({
    mode: "refactor",
    request: "Split PlantViewModal into smaller components",
    stages: [
      {
        name: "Refactor",
        command: "refactor",
        status: "passed",
        workflowId: "wf_refactor_001",
        verdict: "pass",
        score: 82,
        output: "...",
      },
    ],
    finalStatus: "completed",
    runIds: ["wf_refactor_001"],
    applyResult: {
      applied: true,
      branchName: "tpdc/refactor-plantview",
      commitHash: "abc123",
      filesChanged: [
        "src/components/Room/plantViewModal/plantViewModal.component.tsx",
        "src/components/Room/plantViewModal/ImageViewer.tsx",
      ],
    },
    validationResult: { verdict: "pass", score: 82 },
  });

  const output = renderDevelopResult(artifact);
  assert(output.includes("DEVELOP REFACTOR"), "Shows REFACTOR mode");
  assert(output.includes("COMPLETED"), "Shows completed");
  assert(output.includes("1. ✓ Refactor"), "Shows refactor step");
  assert(output.includes("Files:   2"), "Shows file count");
}

// ── Test 7: Declined confirmation ────────────────────────────────────

console.log("\n[Test 7] Declined confirmation path\n");
{
  const artifact = mockArtifact({
    finalStatus: "declined",
    applyResult: { applied: false },
    validationResult: { verdict: "pass", score: 80 },
  });

  const output = renderDevelopResult(artifact);
  assert(output.includes("DECLINED"), "Shows DECLINED status");
  assert(output.includes("Applied: no"), "Shows not applied");
  assert(output.includes("Validation"), "Still shows validation");
}

// ── Test 8: Renderer output structure ────────────────────────────────

console.log("\n[Test 8] Renderer output structure\n");
{
  const artifact = mockArtifact();
  const output = renderDevelopResult(artifact);

  assert(output.includes("DEVELOP FEATURE"), "Has mode header");
  assert(output.includes("Request"), "Has Request section");
  assert(output.includes("Steps (3)"), "Has Steps section with count");
  assert(output.includes("1. ✓ Discovery"), "Step 1 with icon");
  assert(output.includes("2. ✓ Plan"), "Step 2 with icon");
  assert(output.includes("3. ✓ Solve"), "Step 3 with icon");
  assert(output.includes("Apply Result"), "Has Apply Result");
  assert(output.includes("Validation"), "Has Validation");
  assert(output.includes("Run IDs"), "Has Run IDs");
  assert(output.includes("wf_disc_001"), "Shows discovery runId");
  assert(output.includes("wf_solve_001"), "Shows solve runId");
}

// ── Test 9: Develop artifact structure ───────────────────────────────

console.log("\n[Test 9] Artifact structure\n");
{
  const artifact = mockArtifact();

  assert(typeof artifact.mode === "string", "mode is string");
  assert(typeof artifact.request === "string", "request is string");
  assert(Array.isArray(artifact.stages), "stages is array");
  assert(typeof artifact.finalStatus === "string", "finalStatus is string");
  assert(Array.isArray(artifact.runIds), "runIds is array");
  assert(artifact.applyResult !== undefined, "applyResult present");
  assert(artifact.validationResult !== undefined, "validationResult present");

  // Step structure
  const step = artifact.stages[0];
  assert(typeof step.name === "string", "step.name is string");
  assert(typeof step.command === "string", "step.command is string");
  assert(typeof step.status === "string", "step.status is string");
  assert(typeof step.output === "string", "step.output is string");
}

// ── Test 10: Invalid develop mode ────────────────────────────────────

console.log("\n[Test 10] Invalid develop mode\n");
{
  assert(parseDevelopArgs("migrate something") === null, "Rejects migrate mode");
  assert(parseDevelopArgs("assess something") === null, "Rejects assess mode");
  assert(parseDevelopArgs("plan something") === null, "Rejects plan mode");
  assert(parseDevelopArgs("discovery something") === null, "Rejects discovery mode");
}

// ── Test 11: Failed step rendering ───────────────────────────────────

console.log("\n[Test 11] Failed step rendering\n");
{
  const artifact = mockArtifact({
    stages: [
      {
        name: "Discovery",
        command: "discovery",
        status: "failed",
        output: "...",
        blockReason: "LLM adapter timeout",
      },
    ],
    finalStatus: "failed",
    runIds: [],
    applyResult: undefined,
    validationResult: undefined,
  });

  const output = renderDevelopResult(artifact);
  assert(output.includes("FAILED"), "Shows FAILED");
  assert(output.includes("✗ Discovery"), "Shows failed icon");
}

// ── Test 12: Feature flow steps have scores ──────────────────────────

console.log("\n[Test 12] Steps show scores\n");
{
  const artifact = mockArtifact();
  const output = renderDevelopResult(artifact);

  assert(output.includes("(80/100)"), "Plan step shows score");
  assert(output.includes("(85/100)"), "Solve step shows score");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
