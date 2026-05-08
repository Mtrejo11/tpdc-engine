import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

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
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Load and validate an artifact against a Zod schema.
 * Returns null if the artifact is missing, corrupt, or fails validation.
 */
export function loadTypedArtifact<T>(
  runId: string,
  capabilityId: string,
  schema: z.ZodType<T>,
): T | null {
  const raw = loadArtifact(runId, capabilityId);
  if (raw === null) return null;
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}
