#!/usr/bin/env npx ts-node

import * as path from "path";
import * as fs from "fs";
import { runWorkflow, renderWorkflowSummary } from "../src/runtime/workflow";
import { ClaudeCodeAdapter } from "../src/runtime/claude-code-adapter";

async function main() {
  const llm = new ClaudeCodeAdapter({});

  const request = {
    title: "Fix plant image aspect ratio distortion on Android in PlantViewModal",
    body: `Bug: On Android, in PlantViewModal, the plant image becomes distorted/compressed after reviewing it. The image should preserve its aspect ratio and not get stretched or squashed.

Root cause: The expo-image Image component at line 1288 of plantViewModal.component.tsx uses contentFit="fill" which stretches the image to fill the container dimensions without preserving aspect ratio.

Required changes (2 files only):

1. plantViewModal.component.tsx line 1288: Change contentFit="fill" to contentFit="contain"
2. plantViewModal.styles.ts lines 238-241: Update selectedImageContainer to add backgroundColor:"#000" (black letterbox), alignItems:"center", justifyContent:"center"
3. The comment at line 647 says 'contentFit=fill so no letterboxing'. Update that comment to reflect the new contentFit=contain behavior.

Pre-answered questions:
- Letterbox background color: Use black (#000) to match standard image viewer conventions.
- Other screens affected: Out of scope. This fix is only for PlantViewModal.
- iOS impact: contentFit=contain is cross-platform safe. No platform-specific conditional needed.
- Layout jitter: The existing setTimeout guard already delays bbox rendering until after image load.

This is a focused, low-risk bug fix. Do not block on open questions — all product decisions are pre-resolved above.`,
    source: "cli",
  };

  const result = await runWorkflow(request, {
    llm,
    quiet: false,
    apply: true,
    confirmApply: true,
    interactive: false,
    repoRoot: "/Users/mtrejodev/Documents/Adaviv/field-lite",
    fileHints: [
      "src/components/Room/plantViewModal/plantViewModal.component.tsx",
      "src/components/Room/plantViewModal/plantViewModal.styles.ts",
    ],
  });

  console.log(renderWorkflowSummary(result));

  // Print the patches if any
  const artifactDir = path.join(__dirname, "../artifacts", result.workflowId);
  const patchFile = path.join(artifactDir, "execute-patch.json");
  if (fs.existsSync(patchFile)) {
    const patch = JSON.parse(fs.readFileSync(patchFile, "utf-8"));
    console.log("\n--- PATCH ARTIFACT ---");
    console.log(JSON.stringify(patch, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
