/**
 * Persists a polished summary.md into the run's artifact directory.
 */

import * as fs from "fs";
import * as path from "path";
import { RunSummary } from "./runs";
import { renderSummaryMarkdown } from "../plugin/renderers/summaryMarkdown";

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");

export function saveSummaryMarkdown(run: RunSummary): string {
  const content = renderSummaryMarkdown(run);
  const filePath = path.join(ARTIFACTS_DIR, run.workflowId, "summary.md");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}
