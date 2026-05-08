/**
 * Augment-request helper — TPDC v2.
 *
 * When an unblock cycle completes with answers, we re-run the stage with
 * the original request plus a "Clarifications" section so the agent has
 * the new context. Pure function — easy to unit test.
 */

import type { UnblockAnswer } from "../../../schemas/events.js";

export function augmentRequestWithAnswers(
  originalRequest: string,
  answers: UnblockAnswer[],
): string {
  if (answers.length === 0) return originalRequest;

  const qaLines = answers
    .map(
      (a, i) => `Q${i + 1}: ${a.question.trim()}\nA${i + 1}: ${a.answer.trim()}`,
    )
    .join("\n\n");

  return `${originalRequest.trim()}\n\n## Clarifications\n\n${qaLines}`;
}
