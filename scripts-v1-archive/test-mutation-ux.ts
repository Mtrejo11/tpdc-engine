/**
 * Tests for mutation UX improvements.
 *
 * Tests:
 * 1. Preview rendering
 * 2. Declined mutation summary
 * 3. Successful apply summary
 * 4. Rollback summary
 * 5. Show renderer for mutation runs
 * 6. Diff renderer for mutation runs
 * 7. Summary.md for mutation runs
 */

import { renderPreview, PreviewData } from "../src/patch/confirmationPreview";
import { renderShow } from "../src/plugin/renderers/showRenderer";
import { renderDiff } from "../src/plugin/renderers/diffRenderer";
import { renderSummaryMarkdown } from "../src/plugin/renderers/summaryMarkdown";
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

function mockMutationRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    workflowId: "wf_mutation_test",
    timestamp: "2026-03-15T12:00:00Z",
    executionMode: "mutation",
    adapter: { adapterId: "cli", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 180000,
    summary: "Mutation applied successfully.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 30000 },
      { capabilityId: "design", status: "passed", durationMs: 35000 },
      { capabilityId: "decompose", status: "passed", durationMs: 25000 },
      { capabilityId: "execute-patch", status: "passed", durationMs: 45000 },
      { capabilityId: "dry-run", status: "passed", durationMs: 5 },
      { capabilityId: "apply", status: "passed", durationMs: 500 },
      { capabilityId: "validate", status: "passed", durationMs: 40000 },
    ],
    score: 85,
    mutation: {
      applied: true,
      branchName: "tpdc/run-20260315-abc12345",
      commitHash: "abc123def456789",
      filesChanged: [
        "src/components/Room/plantViewModal/plantViewModal.component.tsx",
        "src/components/Room/plantViewModal/plantViewModal.styles.ts",
      ],
      patchGenerated: true,
      dryRunPassed: true,
      confirmationSource: "flag",
      rollbackTriggered: false,
      errors: [],
    },
    findings: [
      { category: "ac_coverage", severity: "minor", description: "All acceptance criteria verified" },
    ],
    artifactPaths: [],
    ...overrides,
  };
}

function mockPreviewData(): PreviewData {
  return {
    runId: "wf_mutation_test",
    repoRoot: "/Users/dev/project",
    patches: [
      {
        filePath: "src/components/Modal.tsx",
        operation: "modify",
        diff: [
          "--- a/src/components/Modal.tsx",
          "+++ b/src/components/Modal.tsx",
          "@@ -10,7 +10,7 @@",
          "   const Component = () => {",
          "-    contentFit=\"fill\"",
          "+    contentFit=\"contain\"",
          "   };",
        ].join("\n"),
      },
      {
        filePath: "src/components/Modal.styles.ts",
        operation: "modify",
        diff: [
          "--- a/src/components/Modal.styles.ts",
          "+++ b/src/components/Modal.styles.ts",
          "@@ -5,6 +5,7 @@",
          "   container: {",
          "     flex: 1,",
          "+    backgroundColor: '#000',",
          "   },",
        ].join("\n"),
      },
      {
        filePath: "src/services/NewService.ts",
        operation: "create",
        diff: [
          "--- /dev/null",
          "+++ b/src/services/NewService.ts",
          "@@ -0,0 +1,5 @@",
          "+export class NewService {",
          "+  async run() {",
          "+    return true;",
          "+  }",
          "+}",
        ].join("\n"),
      },
    ],
    dryRunResult: {
      safe: true,
      applicable: 3,
      conflicts: 0,
      errors: [],
      summary: "All 3 patches applicable",
      patchChecks: [
        { filePath: "src/components/Modal.tsx", operation: "modify", status: "applicable", detail: "" },
        { filePath: "src/components/Modal.styles.ts", operation: "modify", status: "applicable", detail: "" },
        { filePath: "src/services/NewService.ts", operation: "create", status: "applicable", detail: "" },
      ],
      safetyViolations: [],
    },
    planTitle: "Fix image aspect ratio distortion",
  };
}

// ── Test 1: Preview rendering ────────────────────────────────────────

console.log("\n[Test 1] Preview rendering\n");
{
  const data = mockPreviewData();
  const output = renderPreview(data);

  assert(output.includes("MUTATION PREVIEW"), "Has MUTATION PREVIEW header");
  assert(output.includes("Overview"), "Has Overview section");
  assert(output.includes("mutation"), "Shows mode");
  assert(output.includes("/Users/dev/project"), "Shows repo root");
  assert(output.includes("tpdc/run-"), "Shows branch name");
  assert(output.includes("Patches:    3"), "Shows patch count");
  assert(output.includes("Applicable: 3/3"), "Shows applicable count");
  assert(output.includes("PASSED"), "Shows safety status");

  // Files overview
  assert(output.includes("Files (3)"), "Has files section with count");
  assert(output.includes("MODIFY"), "Shows modify operation");
  assert(output.includes("CREATE"), "Shows create operation");
  assert(output.includes("Modal.tsx"), "Shows file name");

  // Diff preview
  assert(output.includes("Diff Preview"), "Has diff preview section");
  assert(output.includes("contentFit"), "Shows diff content");

  // What will happen
  assert(output.includes("create branch"), "Explains what will happen");
}

// ── Test 2: Preview with conflicts ───────────────────────────────────

console.log("\n[Test 2] Preview with conflicts\n");
{
  const data = mockPreviewData();
  data.dryRunResult.safe = true;
  data.dryRunResult.applicable = 2;
  data.dryRunResult.conflicts = 1;
  data.dryRunResult.patchChecks[0].status = "conflict";
  const output = renderPreview(data);

  assert(output.includes("Applicable: 2/3"), "Shows 2/3 applicable");
  assert(output.includes("Conflicts"), "Shows conflicts");
  assert(output.includes("[conflict]"), "Shows conflict label on file");
}

// ── Test 3: Preview with safety violations ───────────────────────────

console.log("\n[Test 3] Preview with safety violations\n");
{
  const data = mockPreviewData();
  data.dryRunResult.safe = false;
  data.dryRunResult.safetyViolations = [
    { filePath: ".env", detail: "Matches deny pattern: .env", rule: "deny" },
  ];
  const output = renderPreview(data);

  assert(output.includes("FAILED"), "Shows safety FAILED");
  assert(output.includes("Safety Violations"), "Has safety violations section");
  assert(output.includes(".env"), "Shows violated file");
  assert(output.includes("blocked"), "Explains apply is blocked");
}

// ── Test 4: Declined mutation ────────────────────────────────────────

console.log("\n[Test 4] Declined mutation in show\n");
{
  const run = mockMutationRun({
    mutation: {
      applied: false,
      branchName: "",
      commitHash: "",
      filesChanged: [],
      patchGenerated: true,
      dryRunPassed: true,
      confirmationSource: "declined",
      rollbackTriggered: false,
      errors: ["Apply declined (interactive)"],
    },
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 30000 },
      { capabilityId: "design", status: "passed", durationMs: 35000 },
      { capabilityId: "decompose", status: "passed", durationMs: 25000 },
      { capabilityId: "execute-patch", status: "passed", durationMs: 45000 },
      { capabilityId: "dry-run", status: "passed", durationMs: 5 },
      { capabilityId: "apply", status: "blocked", durationMs: 100, blockReason: "Apply declined by user" },
      { capabilityId: "validate", status: "passed", durationMs: 40000 },
    ],
  });
  const output = renderShow(run);

  assert(output.includes("NOT APPLIED"), "Shows NOT APPLIED status");
  assert(output.includes("declined"), "Shows declined confirmation source");
  assert(output.includes("Errors"), "Shows error about decline");
}

// ── Test 5: Successful apply in show ─────────────────────────────────

console.log("\n[Test 5] Successful apply in show\n");
{
  const run = mockMutationRun();
  const output = renderShow(run);

  assert(output.includes("APPLIED"), "Shows APPLIED status");
  assert(output.includes("Patches:  generated"), "Shows patches generated");
  assert(output.includes("Dry-run:  passed"), "Shows dry-run passed");
  assert(output.includes("Confirm:  flag"), "Shows confirmation source");
  assert(output.includes("tpdc/run-20260315"), "Shows branch");
  assert(output.includes("abc123def456"), "Shows commit hash");
  assert(output.includes("plantViewModal.component.tsx"), "Shows changed file");
  assert(output.includes("Files:    2"), "Shows file count");
}

// ── Test 6: Rollback in show ─────────────────────────────────────────

console.log("\n[Test 6] Rollback in show\n");
{
  const run = mockMutationRun({
    finalVerdict: "fail",
    mutation: {
      applied: false,
      branchName: "tpdc/run-20260315-abc12345",
      commitHash: "",
      filesChanged: [],
      patchGenerated: true,
      dryRunPassed: true,
      confirmationSource: "flag",
      rollbackTriggered: true,
      errors: ["Apply failed: hunk 1 context not found"],
    },
  });
  const output = renderShow(run);

  assert(output.includes("FAILED"), "Shows FAILED status");
  assert(output.includes("Rollback"), "Shows rollback indicator");
  assert(output.includes("triggered"), "Shows rollback triggered");
  assert(output.includes("hunk 1 context"), "Shows error detail");
}

// ── Test 7: Summary.md for mutation ──────────────────────────────────

console.log("\n[Test 7] Summary.md for successful mutation\n");
{
  const run = mockMutationRun();
  const md = renderSummaryMarkdown(run);

  assert(md.includes("## Mutation Details"), "MD has Mutation Details");
  assert(md.includes("✅ Applied"), "MD shows applied status");
  assert(md.includes("Patches Generated"), "MD shows patch generation");
  assert(md.includes("Dry-Run"), "MD shows dry-run");
  assert(md.includes("Branch"), "MD shows branch");
  assert(md.includes("Commit"), "MD shows commit");
  assert(md.includes("### Changed Files"), "MD has changed files section");
  assert(md.includes("plantViewModal.component.tsx"), "MD lists changed file");
  assert(md.includes("| **Apply Status**"), "MD header table has apply status");
  assert(md.includes("| **Branch**"), "MD header table has branch");
}

// ── Test 8: Summary.md for rollback ──────────────────────────────────

console.log("\n[Test 8] Summary.md for rollback mutation\n");
{
  const run = mockMutationRun({
    finalVerdict: "fail",
    mutation: {
      applied: false,
      branchName: "tpdc/run-20260315-xyz",
      commitHash: "",
      filesChanged: [],
      patchGenerated: true,
      dryRunPassed: false,
      confirmationSource: "flag",
      rollbackTriggered: true,
      errors: ["All patches conflicted"],
    },
    findings: [
      { category: "patch_grounding", severity: "critical", description: "Context lines did not match" },
    ],
  });
  const md = renderSummaryMarkdown(run);

  assert(md.includes("❌ Failed"), "MD shows failed apply");
  assert(md.includes("⚠️ Triggered"), "MD shows rollback");
  assert(md.includes("### Rollback"), "MD has rollback section");
  assert(md.includes("### Mutation Errors"), "MD has mutation errors");
  assert(md.includes("All patches conflicted"), "MD shows error");
  assert(md.includes("### Mutation-Specific Findings"), "MD has mutation findings");
  assert(md.includes("patch_grounding"), "MD shows grounding finding");
}

// ── Test 9: Summary.md for declined mutation ─────────────────────────

console.log("\n[Test 9] Summary.md for declined mutation\n");
{
  const run = mockMutationRun({
    mutation: {
      applied: false,
      branchName: "",
      commitHash: "",
      filesChanged: [],
      patchGenerated: true,
      dryRunPassed: true,
      confirmationSource: "declined",
      rollbackTriggered: false,
      errors: [],
    },
  });
  const md = renderSummaryMarkdown(run);

  assert(md.includes("⊘ Not applied"), "MD shows not-applied");
  assert(md.includes("declined"), "MD shows declined confirmation");
}

// ── Test 10: Show output structure for mutation ──────────────────────

console.log("\n[Test 10] Show mutation sections\n");
{
  const run = mockMutationRun();
  const output = renderShow(run);

  assert(output.includes("Mutation"), "Has Mutation section");
  assert(output.includes("Status:"), "Has apply status line");
  assert(output.includes("Patches:"), "Has patches line");
  assert(output.includes("Dry-run:"), "Has dry-run line");
  assert(output.includes("Confirm:"), "Has confirmation line");
  assert(output.includes("Branch:"), "Has branch line");
  assert(output.includes("Commit:"), "Has commit line");
  assert(output.includes("Files:"), "Has files count line");
}

// ── Test 11: Diff renderer for safe run ──────────────────────────────

console.log("\n[Test 11] Diff for safe-mode run\n");
{
  const run = mockMutationRun({ executionMode: "safe", mutation: undefined });
  const output = renderDiff(run);

  assert(output.includes("safe-mode run"), "Shows safe-mode message");
  assert(output.includes("tpdc show"), "Suggests show command");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
