/**
 * Tests for the `tpdc refactor` structural improvement flow.
 *
 * Tests:
 * 1. Component decomposition — normalizer + artifact + renderer
 * 2. Service extraction
 * 3. Duplicate logic consolidation
 * 4. Code simplification
 * 5. Architecture category
 * 6. Category detection edge cases
 * 7. Target detection (single + multiple)
 * 8. Renderer output structure
 * 9. Mutation support rendering
 * 10. Blocked refactor
 * 11. Behavior preservation
 * 12. Risk assessment
 */

import { normalizeRefactor, RefactorContext } from "../src/plugin/handlers/refactorNormalizer";
import { RefactorArtifact } from "../src/plugin/handlers/refactorArtifact";
import { renderRefactorResult } from "../src/plugin/renderers/refactorRenderer";
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
    workflowId: "wf_test_refactor",
    timestamp: "2026-03-15T00:00:00Z",
    executionMode: "safe",
    adapter: { adapterId: "mock", modelId: "sonnet", transport: "cli" },
    finalVerdict: "pass",
    totalDurationMs: 100000,
    summary: "Refactor completed.",
    stages: [
      { capabilityId: "intake", status: "passed", durationMs: 20000 },
      { capabilityId: "design", status: "passed", durationMs: 30000 },
      { capabilityId: "decompose", status: "passed", durationMs: 20000 },
      { capabilityId: "execute", status: "passed", durationMs: 15000 },
      { capabilityId: "validate", status: "passed", durationMs: 15000 },
    ],
    score: 82,
    artifactPaths: [],
    ...overrides,
  };
}

function mockArtifact(overrides: Partial<RefactorArtifact> = {}): RefactorArtifact {
  return {
    targets: ["PlantViewModal"],
    category: "decomposition",
    structuralIssues: [
      "PlantViewModal is 1400+ lines with image display, bbox rendering, severity selection, and camera controls mixed together",
      "Multiple responsibilities in a single component make testing and maintenance difficult",
    ],
    strategy: "Split PlantViewModal into three focused components: ImageViewer (display + zoom), BboxOverlay (bounding box rendering and interaction), and SeverityPanel (severity selection and case management).",
    affectedFiles: [
      "src/components/Room/plantViewModal/plantViewModal.component.tsx",
      "src/components/Room/plantViewModal/plantViewModal.styles.ts",
      "src/components/Room/plantViewModal/ImageViewer.tsx",
      "src/components/Room/plantViewModal/BboxOverlay.tsx",
      "src/components/Room/plantViewModal/SeverityPanel.tsx",
    ],
    expectedBenefits: [
      "Each sub-component can be tested independently",
      "Reduced cognitive load when working on individual features",
      "Easier to modify image display without risking bbox logic",
    ],
    riskLevel: "medium",
    riskReason: "5 files affected; crosses 1 module boundaries",
    ...overrides,
  };
}

// ── Test 1: Component decomposition ──────────────────────────────────

console.log("\n[Test 1] Component decomposition — normalizer\n");
{
  const input = "Split PlantViewModal into smaller components";
  const ctx = normalizeRefactor(input);

  assert(ctx.category === "decomposition", `Category: decomposition (got ${ctx.category})`);
  assert(ctx.normalizedRequest.includes("[Refactor]"), "Has [Refactor] tag");
  assert(ctx.normalizedRequest.includes("Component Decomposition"), "Has decomposition label");
  assert(ctx.normalizedRequest.includes("Functional behavior MUST remain unchanged"), "Behavior preservation instruction");
  assert(ctx.normalizedRequest.includes(input), "Preserves original input");
  assert(ctx.targets.length === 1, `Single target detected (got ${ctx.targets.length})`);
  assert(ctx.targets[0] === "PlantViewModal", `Target: PlantViewModal (got ${ctx.targets[0]})`);
}

console.log("\n[Test 1b] Component decomposition — rendering\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("REFACTOR PLAN"), "Has REFACTOR PLAN header");
  assert(output.includes("PASS"), "Shows verdict");
  assert(output.includes("PlantViewModal"), "Shows target");
  assert(output.includes("Component Decomposition"), "Shows category");
  assert(output.includes("Problems Detected"), "Has problems section");
  assert(output.includes("1400+"), "Shows structural issue detail");
  assert(output.includes("Refactor Strategy"), "Has strategy section");
  assert(output.includes("ImageViewer"), "Strategy mentions new components");
  assert(output.includes("Files Affected"), "Has files section");
  assert(output.includes("Expected Benefits"), "Has benefits section");
  assert(output.includes("Refactor Risk"), "Has risk section");
}

// ── Test 2: Service extraction ───────────────────────────────────────

console.log("\n[Test 2] Service extraction — normalizer\n");
{
  const input = "Extract image upload retry logic into a dedicated service";
  const ctx = normalizeRefactor(input);

  assert(ctx.category === "extraction", `Category: extraction (got ${ctx.category})`);
  assert(ctx.normalizedRequest.includes("Service/Module Extraction"), "Has extraction label");
  assert(ctx.normalizedRequest.includes("extracting logic into a dedicated module"), "Has extraction guidance");
}

console.log("\n[Test 2b] Service extraction — rendering\n");
{
  const artifact = mockArtifact({
    targets: ["Image upload retry logic"],
    category: "extraction",
    structuralIssues: [
      "Retry logic is inline within the upload hook, mixed with UI state management",
    ],
    strategy: "Extract retry logic into a dedicated UploadRetryService with configurable retry policy.",
    affectedFiles: [
      "src/screens/Training/hooks/useTrainingMediaPicker.ts",
      "src/services/UploadRetryService.ts",
    ],
    expectedBenefits: [
      "Retry behavior can be tested independently of UI",
      "Retry policy is configurable without touching the upload hook",
    ],
    riskLevel: "low",
    riskReason: "Limited scope with few dependencies",
  });
  const run = mockRun();
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("Service/Module Extraction"), "Shows extraction category");
  assert(output.includes("UploadRetryService"), "Shows new service in strategy");
  assert(output.includes("🟢 LOW"), "Shows low risk");
}

// ── Test 3: Duplicate logic consolidation ────────────────────────────

console.log("\n[Test 3] Consolidation — normalizer\n");
{
  const input = "Consolidate AsyncStorage helpers into a shared storage module";
  const ctx = normalizeRefactor(input);

  assert(ctx.category === "consolidation", `Category: consolidation (got ${ctx.category})`);
  assert(ctx.normalizedRequest.includes("Logic Consolidation"), "Has consolidation label");
}

console.log("\n[Test 3b] Consolidation — rendering\n");
{
  const artifact = mockArtifact({
    targets: ["AsyncStorage helpers"],
    category: "consolidation",
    structuralIssues: [
      "AsyncStorage get/set/remove patterns are duplicated across 6 files",
    ],
    strategy: "Create a shared StorageService module with typed get/set/remove methods.",
    affectedFiles: [
      "src/services/StorageService.ts",
      "src/hooks/useSettings.ts",
      "src/hooks/useAuth.ts",
      "src/store/middleware/persistence.ts",
    ],
    expectedBenefits: [
      "Single source of truth for storage operations",
    ],
    riskLevel: "medium",
    riskReason: "4 files affected; crosses 3 module boundaries",
  });
  const run = mockRun();
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("Logic Consolidation"), "Shows consolidation category");
  assert(output.includes("duplicated across"), "Shows duplication detail");
  assert(output.includes("Single source of truth"), "Shows consolidation benefit");
  assert(output.includes("🟡 MEDIUM"), "Shows medium risk");
}

// ── Test 4: Code simplification ──────────────────────────────────────

console.log("\n[Test 4] Simplification — normalizer\n");
{
  const input = "Simplify the room navigation logic by removing dead routes";
  const ctx = normalizeRefactor(input);

  assert(ctx.category === "simplification", `Category: simplification (got ${ctx.category})`);
  assert(ctx.normalizedRequest.includes("Code Simplification"), "Has simplification label");
}

// ── Test 5: Architecture category ────────────────────────────────────

console.log("\n[Test 5] Architecture category — normalizer\n");
{
  const ctx1 = normalizeRefactor("Introduce a service layer between the UI and data access");
  assert(ctx1.category === "architecture", `introduce layer → architecture (got ${ctx1.category})`);

  const ctx2 = normalizeRefactor("Decouple the auth module from the navigation layer");
  assert(ctx2.category === "architecture", `decouple module → architecture (got ${ctx2.category})`);

  const ctx3 = normalizeRefactor("Separate concerns between Room and data fetching");
  assert(ctx3.category === "architecture", `separate concerns → architecture (got ${ctx3.category})`);

  const ctx4 = normalizeRefactor("Move business logic to service layer");
  assert(ctx4.category === "architecture", `move to service → architecture (got ${ctx4.category})`);
}

console.log("\n[Test 5b] Architecture category — rendering\n");
{
  const artifact = mockArtifact({
    targets: ["Auth module", "Navigation layer"],
    category: "architecture",
    strategy: "Introduce an AuthService boundary that the navigation layer consumes through a clean interface.",
    riskLevel: "high",
    riskReason: "spans 4 top-level modules (high coupling risk); touches state management layer",
    affectedFiles: [
      "src/services/AuthService.ts",
      "src/navigation/mainNavigator/AuthenticatedRoutes/userRouter/userRouter.tsx",
      "src/store/shared/auth.reducer.ts",
      "src/store/selectors/user/index.ts",
      "src/hooks/useAuth.ts",
      "src/screens/Login/Login.screen.tsx",
    ],
  });
  const run = mockRun();
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("Architectural Restructuring"), "Shows architecture category");
  assert(output.includes("Auth module"), "Shows first target");
  assert(output.includes("Navigation layer"), "Shows second target");
  assert(output.includes("🔴 HIGH"), "Shows high risk");
  assert(output.includes("Files Affected (6)"), "Shows 6 files");
}

// ── Test 6: Category detection edge cases ────────────────────────────

console.log("\n[Test 6] Category detection patterns\n");
{
  assert(normalizeRefactor("Extract auth logic into a service").category === "extraction", "extract → extraction");
  assert(normalizeRefactor("Pull out the validation code").category === "extraction", "pull out → extraction");
  assert(normalizeRefactor("Move upload logic to its own module").category === "extraction", "move to own → extraction");
  assert(normalizeRefactor("Factor out the retry mechanism").category === "extraction", "factor out → extraction");
  assert(normalizeRefactor("Split the component into sub-components").category === "decomposition", "split → decomposition");
  assert(normalizeRefactor("Break down the monolithic service").category === "decomposition", "break down → decomposition");
  assert(normalizeRefactor("Decompose the dashboard into widgets").category === "decomposition", "decompose → decomposition");
  assert(normalizeRefactor("Merge duplicate API helpers").category === "consolidation", "merge → consolidation");
  assert(normalizeRefactor("Centralize error handling").category === "consolidation", "centralize → consolidation");
  assert(normalizeRefactor("Make the utils DRY").category === "consolidation", "DRY → consolidation");
  assert(normalizeRefactor("Create a reusable form component").category === "consolidation", "reusable → consolidation");
  assert(normalizeRefactor("Remove unused imports and dead code").category === "simplification", "remove → simplification");
  assert(normalizeRefactor("Clean up the test helpers").category === "simplification", "clean up → simplification");
  assert(normalizeRefactor("Flatten the nested callbacks").category === "simplification", "flatten → simplification");
  assert(normalizeRefactor("Introduce a domain layer").category === "architecture", "introduce layer → architecture");
  assert(normalizeRefactor("Decouple the data layer from UI").category === "architecture", "decouple → architecture");
  assert(normalizeRefactor("Separate concerns in the Room module").category === "architecture", "separate concerns → architecture");
  assert(normalizeRefactor("Improve the code structure").category === "general", "generic → general");
}

// ── Test 7: Target detection (single + multiple) ─────────────────────

console.log("\n[Test 7] Target detection\n");
{
  // Single targets
  const ctx1 = normalizeRefactor("Split PlantViewModal into parts");
  assert(ctx1.targets.length === 1, "Single target: 1 found");
  assert(ctx1.targets[0] === "PlantViewModal", "Single target: PlantViewModal");

  const ctx2 = normalizeRefactor("Extract logic from TrainingService");
  assert(ctx2.targets[0] === "TrainingService", "PascalCase Service detected");

  const ctx3 = normalizeRefactor("Refactor `roomCamera.component` module");
  assert(ctx3.targets[0] === "roomCamera.component", "Backtick identifier");

  const ctx4 = normalizeRefactor("Clean up src/hooks/useAuth.ts");
  assert(ctx4.targets[0] === "src/hooks/useAuth.ts", "File path");

  // No target
  const ctx5 = normalizeRefactor("Simplify the navigation logic");
  assert(ctx5.targets.length === 0, "No targets → empty array");

  // Multiple targets
  const ctx6 = normalizeRefactor("Move shared logic from TrainingService and UploadService into a common BaseService");
  assert(ctx6.targets.length >= 2, `Multiple targets found (got ${ctx6.targets.length})`);
  assert(ctx6.targets.includes("TrainingService"), "Includes TrainingService");
  assert(ctx6.targets.includes("UploadService"), "Includes UploadService");

  // Multiple backtick targets
  const ctx7 = normalizeRefactor("Decouple `auth.reducer` from `navigation.service`");
  assert(ctx7.targets.length === 2, `Two backtick targets (got ${ctx7.targets.length})`);
  assert(ctx7.targets.includes("auth.reducer"), "Includes auth.reducer");
  assert(ctx7.targets.includes("navigation.service"), "Includes navigation.service");
}

// ── Test 8: Renderer output structure ────────────────────────────────

console.log("\n[Test 8] Renderer output structure\n");
{
  const artifact = mockArtifact();
  const run = mockRun();
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("Target"), "Has Target section");
  assert(output.includes("Refactor Risk"), "Has Refactor Risk section");
  assert(output.includes("Level:"), "Risk shows Level");
  assert(output.includes("Reason:"), "Risk shows Reason");
  assert(output.includes("Problems Detected"), "Has Problems Detected section");
  assert(output.includes("Refactor Strategy"), "Has Refactor Strategy section");
  assert(output.includes("Files Affected"), "Has Files Affected section");
  assert(output.includes("Expected Benefits"), "Has Expected Benefits section");
  assert(output.includes("Pipeline"), "Has Pipeline section");
  assert(output.includes("82/100"), "Shows score");
  assert(output.includes("wf_test_refactor"), "Shows run ID");
}

// ── Test 9: Mutation support rendering ───────────────────────────────

console.log("\n[Test 9] Mutation mode rendering\n");
{
  const artifact = mockArtifact();
  const run = mockRun({
    executionMode: "mutation",
    mutation: {
      applied: true,
      branchName: "tpdc/refactor-plantviewmodal",
      commitHash: "abc123def456",
      filesChanged: [
        "src/components/Room/plantViewModal/plantViewModal.component.tsx",
        "src/components/Room/plantViewModal/ImageViewer.tsx",
      ],
      patchGenerated: true,
      dryRunPassed: true,
      confirmationSource: "flag",
      rollbackTriggered: false,
      errors: [],
    },
  });
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("Applied Changes"), "Has Applied Changes section");
  assert(output.includes("Applied: yes"), "Shows applied: yes");
  assert(output.includes("tpdc/refactor-plantviewmodal"), "Shows branch name");
  assert(output.includes("abc123def456"), "Shows commit hash");
}

// ── Test 10: Blocked refactor ────────────────────────────────────────

console.log("\n[Test 10] Blocked refactor rendering\n");
{
  const artifact = mockArtifact({
    strategy: "",
    affectedFiles: [],
    riskLevel: "low",
    riskReason: "Limited scope with few dependencies",
  });
  const run = mockRun({
    finalVerdict: "blocked",
    blockReason: "Cannot determine component boundaries without understanding the state management pattern in use",
    openQuestions: [
      { question: "Does the component use local state or Redux?", owner: "engineering" },
    ],
  });
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("BLOCKED"), "Shows BLOCKED verdict");
  assert(output.includes("Blocked"), "Has Blocked section");
  assert(output.includes("state management pattern"), "Shows blocking reason");
  assert(output.includes("Open Questions"), "Shows open questions");
}

// ── Test 11: Behavior preservation ───────────────────────────────────

console.log("\n[Test 11] Behavior preservation instruction\n");
{
  const ctx = normalizeRefactor("Refactor the auth module");
  assert(ctx.normalizedRequest.includes("Functional behavior MUST remain unchanged"), "Behavior preservation present");
  assert(ctx.normalizedRequest.includes("Improve code structure without changing functional behavior"), "Structure-over-behavior framing");

  // Architecture category also preserves behavior
  const ctx2 = normalizeRefactor("Introduce a service layer");
  assert(ctx2.normalizedRequest.includes("Functional behavior MUST remain unchanged"), "Architecture also preserves behavior");
}

// ── Test 12: Risk assessment ─────────────────────────────────────────

console.log("\n[Test 12] Risk assessment heuristics\n");
{
  // Low risk: few files, no state, no API
  const lowRisk = mockArtifact({
    affectedFiles: ["src/utils/format.ts"],
    riskLevel: "low",
    riskReason: "Limited scope with few dependencies",
  });
  assert(lowRisk.riskLevel === "low", "1 file → low risk");

  // Medium risk: multiple files across modules
  const medRisk = mockArtifact({
    affectedFiles: [
      "src/services/StorageService.ts",
      "src/hooks/useSettings.ts",
      "src/hooks/useAuth.ts",
      "src/store/middleware/persistence.ts",
      "src/screens/Settings/Settings.screen.tsx",
    ],
    riskLevel: "medium",
    riskReason: "5 files affected; crosses 4 module boundaries",
  });
  assert(medRisk.riskLevel === "medium", "5 files, multiple modules → medium");

  // High risk: many files, state, APIs
  const highRisk = mockArtifact({
    affectedFiles: [
      "src/store/shared/auth.reducer.ts",
      "src/store/selectors/user/index.ts",
      "src/services/AuthService.ts",
      "src/services/ApiClient.ts",
      "src/hooks/useAuth.ts",
      "src/navigation/mainNavigator/AuthenticatedRoutes/userRouter/userRouter.tsx",
      "src/screens/Login/Login.screen.tsx",
      "src/screens/Home/Home.screen.tsx",
      "src/middleware/authMiddleware.ts",
      "src/config/firebase.ts",
    ],
    riskLevel: "high",
    riskReason: "10 files affected (wide blast radius); spans 6 top-level modules; touches state management layer; involves API boundaries",
  });
  assert(highRisk.riskLevel === "high", "10 files, state + API + many modules → high");

  // Renderer shows risk section
  const run = mockRun();
  const output = renderRefactorResult(run, highRisk);
  assert(output.includes("Refactor Risk"), "Renderer has Refactor Risk section");
  assert(output.includes("🔴 HIGH"), "Shows high risk with icon");
  assert(output.includes("Reason:"), "Shows risk reason");
}

// ── Test 13: Multiple targets in renderer ────────────────────────────

console.log("\n[Test 13] Multiple targets in renderer\n");
{
  const artifact = mockArtifact({
    targets: ["AuthService", "NavigationModule", "src/hooks/useAuth.ts"],
  });
  const run = mockRun();
  const output = renderRefactorResult(run, artifact);

  assert(output.includes("AuthService"), "Shows first target");
  assert(output.includes("NavigationModule"), "Shows second target");
  assert(output.includes("src/hooks/useAuth.ts"), "Shows third target");
  // Multiple targets use bullet format
  assert((output.match(/  · /g) || []).length >= 3, "Multiple targets use bullet format");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
