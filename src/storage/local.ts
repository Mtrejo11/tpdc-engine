import * as fs from "fs";
import * as path from "path";

const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");

export function saveArtifact(runId: string, capabilityId: string, data: unknown): string {
  const runDir = path.join(ARTIFACTS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const filePath = path.join(runDir, `${capabilityId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

  return filePath;
}

export function saveRawOutput(runId: string, capabilityId: string, raw: string): string {
  const runDir = path.join(ARTIFACTS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const filePath = path.join(runDir, `${capabilityId}.raw.txt`);
  fs.writeFileSync(filePath, raw, "utf-8");

  return filePath;
}

export function loadArtifact(runId: string, capabilityId: string): unknown | null {
  const filePath = path.join(ARTIFACTS_DIR, runId, `${capabilityId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}
