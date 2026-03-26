import * as fs from "fs";
import * as path from "path";
import { CapabilityDefinition, CapabilityDefinitionSchema } from "../protocols";

const INSTALLED_DIR = path.resolve(__dirname, "../../capabilities/installed");

// Allowlist for capability IDs and version strings — prevents path traversal
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

function assertSafePathSegment(segment: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(segment)) {
    throw new Error(`Invalid ${label}: "${segment}" — only alphanumeric, dot, dash, and underscore allowed`);
  }
}

export function listInstalledCapabilities(): CapabilityDefinition[] {
  if (!fs.existsSync(INSTALLED_DIR)) return [];

  const capabilities: CapabilityDefinition[] = [];
  const dirs = fs.readdirSync(INSTALLED_DIR);

  for (const dir of dirs) {
    const capDir = path.join(INSTALLED_DIR, dir);
    if (!fs.statSync(capDir).isDirectory()) continue;

    // Check version subdirectories
    const versions = fs.readdirSync(capDir);
    for (const ver of versions) {
      const verDir = path.join(capDir, ver);
      if (!fs.statSync(verDir).isDirectory()) continue;

      const manifestPath = path.join(verDir, "capability.json");
      if (fs.existsSync(manifestPath)) {
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const parsed = CapabilityDefinitionSchema.parse(raw);
        capabilities.push(parsed);
      }
    }
  }

  return capabilities;
}

export function loadCapability(id: string, version?: string): {
  definition: CapabilityDefinition;
  prompt: string;
  inputSchema: object;
  outputSchema: object;
  basePath: string;
} | null {
  if (!fs.existsSync(INSTALLED_DIR)) return null;

  assertSafePathSegment(id, "capability ID");

  const capDir = path.join(INSTALLED_DIR, id);
  if (!capDir.startsWith(INSTALLED_DIR + path.sep)) return null;
  if (!fs.existsSync(capDir)) return null;

  let targetVersion = version;
  if (!targetVersion) {
    // Use latest version (proper semver sort)
    const versions = fs.readdirSync(capDir).filter(v => {
      const vPath = path.join(capDir, v);
      return fs.statSync(vPath).isDirectory();
    });
    if (versions.length === 0) return null;
    targetVersion = versions.sort(compareSemver).pop()!;
  } else {
    assertSafePathSegment(targetVersion, "capability version");
  }

  const verDir = path.join(capDir, targetVersion);
  if (!fs.existsSync(verDir)) return null;

  const manifestPath = path.join(verDir, "capability.json");
  const promptPath = path.join(verDir, "prompt.md");
  const inputSchemaPath = path.join(verDir, "input.schema.json");
  const outputSchemaPath = path.join(verDir, "output.schema.json");

  if (!fs.existsSync(manifestPath)) return null;

  const definition = CapabilityDefinitionSchema.parse(
    JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
  );

  const prompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf-8")
    : "";

  const inputSchema = fs.existsSync(inputSchemaPath)
    ? JSON.parse(fs.readFileSync(inputSchemaPath, "utf-8"))
    : {};

  const outputSchema = fs.existsSync(outputSchemaPath)
    ? JSON.parse(fs.readFileSync(outputSchemaPath, "utf-8"))
    : {};

  return { definition, prompt, inputSchema, outputSchema, basePath: verDir };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
