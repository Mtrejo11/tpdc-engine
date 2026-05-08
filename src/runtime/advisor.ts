/**
 * Advisor pattern — TPDC v2.
 *
 * The executor (Sonnet/Haiku) consults the advisor (Opus) on
 * complex decisions, rather than running every step on Opus.
 * Reduces cost while preserving quality on critical reasoning.
 *
 * Reference:
 *   https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
 *   https://claude.com/blog/the-advisor-strategy
 *
 * Numbers from the Anthropic blog (May 2026):
 *   - Sonnet alone:               72.1% SWE-Bench, 1.00x cost
 *   - Sonnet + Opus advisor:      74.8% SWE-Bench, 0.88x cost
 *   - Haiku + Opus advisor:       41.2% BrowseComp, 0.26x of Sonnet alone
 *
 * Implementation note: this is a stub. The real wiring is via Anthropic's
 * built-in advisor tool surface (a tool the executor can call mid-turn).
 * We expose a typed wrapper here so callers reason about advisor consults
 * as a domain operation rather than a raw API call.
 */

export interface AdvisorRequest {
  /** Short label for what kind of decision is being escalated */
  decisionType: string;
  /** Full executor transcript or context the advisor needs to evaluate */
  context: string;
  /** Specific question the executor wants the advisor to answer */
  question: string;
}

export interface AdvisorResponse {
  guidance: string;
  /** Token usage for cost tracking */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function consultAdvisor(_req: AdvisorRequest): Promise<AdvisorResponse> {
  throw new Error(
    "consultAdvisor: not implemented yet (v2 stub). Wire to Anthropic advisor tool.",
  );
}
