/**
 * Discovery request normalizer.
 *
 * Tags the request as a discovery/framing exercise and detects
 * the likely command category so we can suggest a next step.
 */

export type SuggestedCommand = "solve" | "fix" | "assess" | "refactor" | "migrate";

export interface DiscoveryContext {
  /** Normalized request string to pass to the workflow */
  normalizedRequest: string;
  /** Detected likely downstream command */
  likelyCommand: SuggestedCommand;
  /** The original raw input */
  rawInput: string;
}

const COMMAND_PATTERNS: Array<[RegExp, SuggestedCommand]> = [
  [/\b(bug\w*|crash\w*|broken|fail\w*|error\w*|wrong|regress\w*|not\s+work\w*|doesn.t\s+work\w*)\b/i, "fix"],
  [/\b(port\w*|migrat\w*|move\s+from|transition\w*|replac\w*|swap\w*|switch\s+from|upgrade\w*)\b/i, "migrate"],
  [/\b(refactor\w*|clean\s*up|restructur\w*|reorganiz\w*|decouple\w*|extract\w*|simplif\w*|consolidat\w*|modulariz\w*)\b/i, "refactor"],
  [/\b(audit\w*|assess\w*|evaluat\w*|analyz\w*|check\w*|review\w*|inspect\w*|secur\w*|risk\w*|vulnerab\w*)\b/i, "assess"],
];

export function normalizeDiscovery(raw: string): DiscoveryContext {
  let likelyCommand: SuggestedCommand = "solve";

  for (const [pattern, cmd] of COMMAND_PATTERNS) {
    if (pattern.test(raw)) {
      likelyCommand = cmd;
      break;
    }
  }

  const normalizedRequest = [
    `[Discovery] Frame and analyze the following idea.`,
    `Do NOT produce implementation code or patches.`,
    `Focus on: problem framing, affected areas, constraints, assumptions,`,
    `risks, alternative approaches, tradeoffs, and a recommended direction.`,
    `Identify what is missing or unclear before this can be executed.`,
    "",
    raw,
  ].join("\n");

  return {
    normalizedRequest,
    likelyCommand,
    rawInput: raw,
  };
}
