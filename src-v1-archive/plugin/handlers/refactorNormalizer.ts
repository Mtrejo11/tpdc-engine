/**
 * Refactor request normalizer.
 *
 * Tags the request as a structural improvement and extracts
 * the refactor category to guide the workflow and renderer.
 */

export type RefactorCategory = "extraction" | "decomposition" | "consolidation" | "simplification" | "architecture" | "general";

export interface RefactorContext {
  /** Normalized request string to pass to the workflow */
  normalizedRequest: string;
  /** Detected refactor category */
  category: RefactorCategory;
  /** Target modules/components/files if detected */
  targets: string[];
  /** The original raw input */
  rawInput: string;
}

const CATEGORY_PATTERNS: Array<[RegExp, RefactorCategory]> = [
  [/\b(extract\w*|pull\s+out|move\b.*\b(?:into|to\s+(?:its|a|the|own|new|dedicated|separate))|isolat\w*|factor\s+out|split\s+(?:out|off))\b/i, "extraction"],
  [/\b(split\w*|break\s+(?:up|down|apart)|decompos\w*|partition\w*|modulariz\w*)\b/i, "decomposition"],
  [/\b(consolidat\w*|merg\w*|unif\w*|centraliz\w*|deduplic\w*|DRY|shared|common|reusab\w*)\b/i, "consolidation"],
  [/\b(simplif\w*|reduc\w*|clean\s*up|remov\w*|eliminat\w*|flatten\w*|inline\w*|streamlin\w*)\b/i, "simplification"],
  [/\b(introduc\w*\s+layer|add\w*\s+layer|decouple\w*|separate\s+concern\w*|move\b.*\bto\s+service|service\s+layer|domain\s+layer|boundar\w*|layer\w*\s+architect\w*|inversion\s+of\s+control|depend\w*\s+inject\w*)\b/i, "architecture"],
];

export function normalizeRefactor(raw: string): RefactorContext {
  let category: RefactorCategory = "general";

  for (const [pattern, cat] of CATEGORY_PATTERNS) {
    if (pattern.test(raw)) {
      category = cat;
      break;
    }
  }

  // Detect target components/modules/files (multiple)
  const targets = detectTargets(raw);

  const normalizedRequest = [
    `[Refactor] [${categoryLabel(category)}]`,
    `Improve code structure without changing functional behavior.`,
    `Focus on: ${categoryGuidance(category)}.`,
    `Functional behavior MUST remain unchanged unless absolutely required.`,
    "",
    raw,
  ].join("\n");

  return {
    normalizedRequest,
    category,
    targets,
    rawInput: raw,
  };
}

function detectTargets(raw: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  // Match PascalCase component/class names (all occurrences)
  const componentRegex = /\b([A-Z][a-zA-Z]+(?:Screen|Modal|View|Component|Service|Hook|Provider|Manager|Controller|Helper|Utils?|Module|Store|Reducer|Slice|Middleware|Context))\b/g;
  let match;
  while ((match = componentRegex.exec(raw)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      targets.push(match[1]);
    }
  }

  // Match backtick-quoted identifiers (all occurrences)
  const backtickRegex = /`([A-Za-z][A-Za-z0-9_./-]+)`/g;
  while ((match = backtickRegex.exec(raw)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      targets.push(match[1]);
    }
  }

  // Match file paths (all occurrences)
  const pathRegex = /\b((?:src|lib|app|components|services|hooks|utils|modules)\/[A-Za-z0-9_/.]+)\b/g;
  while ((match = pathRegex.exec(raw)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      targets.push(match[1]);
    }
  }

  return targets;
}

function categoryLabel(cat: RefactorCategory): string {
  switch (cat) {
    case "extraction": return "Service/Module Extraction";
    case "decomposition": return "Component Decomposition";
    case "consolidation": return "Logic Consolidation";
    case "simplification": return "Code Simplification";
    case "architecture": return "Architectural Restructuring";
    case "general": return "Structural Improvement";
  }
}

function categoryGuidance(cat: RefactorCategory): string {
  switch (cat) {
    case "extraction":
      return "extracting logic into a dedicated module or service, defining clear interfaces, reducing coupling";
    case "decomposition":
      return "splitting large components into smaller focused units, improving readability and testability";
    case "consolidation":
      return "merging duplicated logic into shared modules, eliminating redundancy, establishing single sources of truth";
    case "simplification":
      return "reducing complexity, removing dead code, flattening unnecessary abstractions, streamlining control flow";
    case "architecture":
      return "introducing or enforcing architectural layers, decoupling modules, establishing clear boundaries between concerns";
    case "general":
      return "improving code organization, maintainability, and clarity without changing behavior";
  }
}
