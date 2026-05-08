#!/usr/bin/env npx ts-node

/**
 * Direct patch apply for the PlantViewModal bug.
 * Uses the best patch artifact from the pipeline runs, with
 * manually corrected context lines for unique matching.
 */

import * as path from "path";
import * as fs from "fs";
import { dryRunValidate, PatchInput } from "../src/patch/dryRun";
import { defaultSafetyConfig } from "../src/patch/safetyChecks";
import { gitApplyPatches } from "../src/patch/gitIntegration";

const repoRoot = "/Users/mtrejodev/Documents/Adaviv/field-lite";
const runId = "wf_1773121218621_direct";

// ── Patches ──────────────────────────────────────────────────────────
// These are the three changes from the best pipeline run,
// with context lines verified against the actual file.

const patches: PatchInput[] = [
  {
    filePath: "src/components/Room/plantViewModal/plantViewModal.component.tsx",
    operation: "modify",
    diff: [
      "--- a/src/components/Room/plantViewModal/plantViewModal.component.tsx",
      "+++ b/src/components/Room/plantViewModal/plantViewModal.component.tsx",
      "@@ -1285,7 +1285,7 @@",
      "                   ))}",
      "               </Canvas>",
      "               <Image",
      '-                contentFit="fill"',
      '+                contentFit="contain"',
      "                 source={imageSrc}",
      "                 style={[style.selectedImage]}",
      "                 onLayout={(event) => {",
    ].join("\n"),
  },
  {
    filePath: "src/components/Room/plantViewModal/plantViewModal.styles.ts",
    operation: "modify",
    diff: [
      "--- a/src/components/Room/plantViewModal/plantViewModal.styles.ts",
      "+++ b/src/components/Room/plantViewModal/plantViewModal.styles.ts",
      "@@ -238,6 +238,7 @@",
      "     selectedImageContainer: {",
      "       borderRadius: 8,",
      "       flex: 1,",
      '+      backgroundColor: "#000",',
      "     },",
      "     bottomInfoContainer: {",
    ].join("\n"),
  },
  {
    filePath: "src/components/Room/plantViewModal/plantViewModal.component.tsx",
    operation: "modify",
    diff: [
      "--- a/src/components/Room/plantViewModal/plantViewModal.component.tsx",
      "+++ b/src/components/Room/plantViewModal/plantViewModal.component.tsx",
      "@@ -645,10 +645,10 @@",
      "       const imageBboxes: BoundingBox[] = selectedImage.boundingBoxes;",
      " ",
      '-      // The image uses contentFit="fill" so it always fills widthOfImage×heightOfImage',
      "-      // exactly — no letterboxing. Worker bboxes are stored in capture-stage coords",
      "-      // (canvasWidth×canvasHeight) where the capture stage also had no letterboxing.",
      "-      // So the transform is a simple proportional scale: stageX / captureW * displayW.",
      '+      // The image uses contentFit="contain" — it scales to fit within widthOfImage×heightOfImage',
      "+      // while preserving aspect ratio (black letterbox fills any unused space).",
      "+      // Worker bboxes are stored in capture-stage coords (canvasWidth×canvasHeight).",
      "+      // The transform is a simple proportional scale: stageX / captureW * displayW.",
      "       console.log(",
    ].join("\n"),
  },
];

// ── Run ──────────────────────────────────────────────────────────────

const safetyConfig = defaultSafetyConfig(repoRoot);
const dryRun = dryRunValidate(patches, safetyConfig);

console.log("=== DRY-RUN RESULTS ===");
console.log(`Safe: ${dryRun.safe}`);
console.log(`Summary: ${dryRun.summary}`);
for (const check of dryRun.patchChecks) {
  const relocInfo = check.relocations
    ?.filter((r) => r.confidence === "fuzzy")
    .map((r) => ` (relocated: ${r.originalStart} → ${r.relocatedStart}, offset ${r.offset > 0 ? "+" : ""}${r.offset})`)
    .join("") ?? "";
  console.log(`  [${check.status}] ${check.filePath} (${check.operation}): ${check.detail}${relocInfo}`);
}

if (dryRun.applicable === 0) {
  console.error("\nNo applicable patches. Aborting.");
  process.exit(1);
}

if (dryRun.conflicts > 0) {
  console.warn(`\n⚠ ${dryRun.conflicts} conflict(s) — proceeding with partial apply.`);
}

console.log("\n=== APPLYING PATCHES ===");
const result = gitApplyPatches(patches, {
  repoRoot,
  confirmed: true,
  dryRunResult: dryRun,
  runId,
  planTitle: "Fix plant image aspect ratio distortion on Android in PlantViewModal",
  changeSummary: "Changes contentFit from fill to contain, adds black letterbox background, updates bbox comment.",
});

console.log(`Apply status: ${result.applyResult.status}`);
console.log(`Files changed: ${result.applyResult.filesChanged}`);
for (const fr of result.applyResult.fileResults) {
  console.log(`  [${fr.status}] ${fr.filePath}: ${fr.detail}`);
}
console.log(`\nBranch: ${result.git.branchName}`);
console.log(`Commit: ${result.git.commitHash}`);
console.log(`Branch created: ${result.git.branchCreated}`);
console.log(`Commit created: ${result.git.commitCreated}`);

if (result.git.errors.length > 0) {
  console.log("Git errors:", result.git.errors);
}

// Show the diff for verification
if (result.git.commitCreated) {
  const { execSync } = require("child_process");
  console.log("\n=== COMMITTED DIFF ===");
  const diff = execSync("git diff HEAD~1", { cwd: repoRoot, encoding: "utf-8" });
  console.log(diff);
}
