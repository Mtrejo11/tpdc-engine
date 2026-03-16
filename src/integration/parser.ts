/**
 * Explicit command parser for TPDC invocations.
 *
 * Only matches explicitly namespaced TPDC commands.
 * Does NOT infer intent from arbitrary freeform text.
 *
 * Supported forms:
 *   tpdc:fix "description"
 *   tpdc:solve "description"
 *   tpdc:discovery "idea"
 *   tpdc:assess "request"
 *   tpdc:plan "request"
 *   tpdc:refactor "request"
 *   tpdc:show <runId>
 *   tpdc:diff <runId>
 *   tpdc:show  (no args — list recent)
 */

export type TpdcCommand =
  | "discovery"
  | "assess"
  | "plan"
  | "solve"
  | "fix"
  | "refactor"
  | "show"
  | "diff"
  | "develop";

export interface ParsedInvocation {
  command: TpdcCommand;
  args: string;
  flags: ParsedFlags;
}

export interface ParsedFlags {
  apply?: boolean;
  confirmApply?: boolean;
  interactive?: boolean;
  repoRoot?: string;
}

const VALID_COMMANDS: TpdcCommand[] = [
  "discovery", "assess", "plan", "solve", "fix", "refactor", "show", "diff", "develop",
];

/**
 * Parse an explicit TPDC invocation from text.
 *
 * Returns null if the text does not contain an explicit `tpdc:<command>` invocation.
 * This is intentionally strict — no fuzzy matching, no intent inference.
 */
export function parseInvocation(text: string): ParsedInvocation | null {
  const trimmed = text.trim();

  // Match: tpdc:<command> followed by args
  const match = trimmed.match(/^tpdc:(\w+)\s*(.*)?$/is);
  if (!match) return null;

  const commandStr = match[1].toLowerCase();
  const rawArgs = (match[2] || "").trim();

  // Validate command
  if (!VALID_COMMANDS.includes(commandStr as TpdcCommand)) {
    return null;
  }

  const command = commandStr as TpdcCommand;

  // Parse flags from args
  const { args, flags } = extractFlags(rawArgs);

  return { command, args, flags };
}

/**
 * Extract flags (--apply, --repo-root, etc.) from the args string.
 * Returns the cleaned args and parsed flags.
 */
function extractFlags(raw: string): { args: string; flags: ParsedFlags } {
  const flags: ParsedFlags = {};
  let args = raw;

  // --repo-root <path>
  const repoRootMatch = args.match(/--repo-root\s+(\S+)/);
  if (repoRootMatch) {
    flags.repoRoot = repoRootMatch[1];
    args = args.replace(repoRootMatch[0], "").trim();
  }

  // --apply
  if (/--apply\b/.test(args)) {
    flags.apply = true;
    args = args.replace(/--apply\b/, "").trim();
  }

  // --confirm-apply
  if (/--confirm-apply\b/.test(args)) {
    flags.confirmApply = true;
    args = args.replace(/--confirm-apply\b/, "").trim();
  }

  // --interactive
  if (/--interactive\b/.test(args)) {
    flags.interactive = true;
    args = args.replace(/--interactive\b/, "").trim();
  }

  // Strip surrounding quotes from the args
  args = args.replace(/^["']|["']$/g, "").trim();

  return { args, flags };
}

/**
 * Check if text contains an explicit TPDC invocation.
 * Quick check without full parsing — useful for routing.
 */
export function isTpdcInvocation(text: string): boolean {
  return /^tpdc:\w+/i.test(text.trim());
}

// ── Develop subcommand parsing ───────────────────────────────────────

export type DevelopMode = "feature" | "bug" | "refactor";

export interface ParsedDevelop {
  mode: DevelopMode;
  request: string;
  flags: ParsedFlags;
}

const VALID_DEVELOP_MODES: DevelopMode[] = ["feature", "bug", "refactor"];

/**
 * Parse the develop subcommand from a parsed invocation's args.
 * Expected format: `feature|bug|refactor "<request>" [flags]`
 */
export function parseDevelopArgs(args: string): ParsedDevelop | null {
  const match = args.match(/^(feature|bug|refactor)\s+(.+)$/is);
  if (!match) return null;

  const mode = match[1].toLowerCase() as DevelopMode;
  const rest = match[2].trim();

  const { args: request, flags } = extractFlags(rest);

  if (!request) return null;

  return { mode, request, flags };
}
