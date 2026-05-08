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
 * Numbers from Anthropic's blog (May 2026):
 *   - Sonnet alone:           72.1% SWE-Bench, 1.00x cost
 *   - Sonnet + Opus advisor:  74.8% SWE-Bench, 0.88x cost
 *   - Haiku alone:            19.7% BrowseComp
 *   - Haiku + Opus advisor:   41.2% BrowseComp, 0.26x of Sonnet alone
 *
 * Implementation: thin wrapper around runExecutor() with the Opus model
 * and an output schema that captures the advisor's structured guidance.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DEFAULT_ADVISOR_MODEL, runExecutor } from "./executor.js";

export const AdvisorResponseSchema = z.object({
  guidance: z
    .string()
    .min(1)
    .describe("Concrete, actionable direction for the executor to follow."),
  rationale: z
    .string()
    .describe("Why this guidance — the reasoning that led to it."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "How confident the advisor is in this guidance, given the available context.",
    ),
  caveats: z
    .array(z.string())
    .default([])
    .describe(
      "Conditions under which this guidance might be wrong or need revision.",
    ),
});
export type AdvisorResponse = z.infer<typeof AdvisorResponseSchema>;

export interface AdvisorRequest {
  /** Short label for what kind of decision is being escalated */
  decisionType: string;
  /** The executor's transcript / context the advisor needs to evaluate */
  context: string;
  /** The specific question the executor wants answered */
  question: string;
  /** Override advisor model. Defaults to Opus 4.6. */
  model?: string;
  /** Optional client override (for tests). */
  client?: Anthropic;
}

const ADVISOR_SYSTEM_PROMPT = `You are the **Advisor** in a TPDC autonomous development workflow.

An executor agent (running on a less capable model) has hit a decision it
cannot resolve on its own. It has handed you the full context and a
specific question. Your job:

1. Read the context carefully.
2. Answer the question with concrete, actionable guidance.
3. Explain your reasoning so the executor (and a human auditor) can verify it.
4. Surface caveats — conditions under which your guidance could be wrong.

You are NOT the executor. You produce guidance, not actions. The executor
will resume with your guidance as input. Be clear, be specific, be brief.

If the question is unanswerable from the context provided, say so in
guidance and explain what additional context would be needed.`;

/**
 * Consult the advisor (typically Opus 4.6) for guidance on a complex decision.
 *
 * Throws if the advisor output fails schema validation (extremely rare with
 * Anthropic's structured outputs).
 */
export async function consultAdvisor(req: AdvisorRequest): Promise<AdvisorResponse & {
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}> {
  const userInput = [
    `# Decision type`,
    req.decisionType,
    ``,
    `# Question`,
    req.question,
    ``,
    `# Context`,
    req.context,
  ].join("\n");

  const result = await runExecutor({
    systemPrompt: ADVISOR_SYSTEM_PROMPT,
    userInput,
    outputSchema: AdvisorResponseSchema,
    model: req.model ?? DEFAULT_ADVISOR_MODEL,
    client: req.client,
  });

  return {
    ...result.output,
    usage: result.usage,
    model: result.model,
  };
}
