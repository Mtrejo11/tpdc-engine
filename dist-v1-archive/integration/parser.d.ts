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
export type TpdcCommand = "discovery" | "assess" | "plan" | "solve" | "fix" | "refactor" | "show" | "diff" | "develop";
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
/**
 * Safely convert a string to a TpdcCommand, or throw.
 */
export declare function toCommand(s: string): TpdcCommand;
/**
 * Parse an explicit TPDC invocation from text.
 *
 * Returns null if the text does not contain an explicit `tpdc:<command>` invocation.
 * This is intentionally strict — no fuzzy matching, no intent inference.
 */
export declare function parseInvocation(text: string): ParsedInvocation | null;
/**
 * Check if text contains an explicit TPDC invocation.
 * Quick check without full parsing — useful for routing.
 */
export declare function isTpdcInvocation(text: string): boolean;
export type DevelopMode = "feature" | "bug" | "refactor";
export interface ParsedDevelop {
    mode: DevelopMode;
    request: string;
    flags: ParsedFlags;
}
/**
 * Parse the develop subcommand from a parsed invocation's args.
 * Expected format: `feature|bug|refactor "<request>" [flags]`
 */
export declare function parseDevelopArgs(args: string): ParsedDevelop | null;
