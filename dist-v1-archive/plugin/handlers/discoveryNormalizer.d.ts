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
export declare function normalizeDiscovery(raw: string): DiscoveryContext;
