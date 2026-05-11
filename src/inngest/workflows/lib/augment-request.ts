/**
 * Augment-request helpers — TPDC v2.
 *
 * When an unblock cycle (human or team-of-agents) completes, we re-run the
 * intake stage with the original request plus a section explaining the new
 * context. Pure functions — easy to unit test.
 *
 * Two flavors:
 *   - `augmentRequestWithAnswers` for human Q&A unblocks (legacy + manual mode)
 *   - `augmentRequestWithTeamMeeting` for team-of-agents synthesis (D6, auto/hybrid)
 *
 * Output format choices are deliberate — see `docs/team-of-agents-spec.md` §8.1.
 */

import type { UnblockAnswer } from "../../../schemas/events.js";
import type { TeamMeetingResult } from "../../../teams/schemas.js";

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

/**
 * Format a team-of-agents meeting result as a markdown section appended to
 * the original request. Used in `auto`/`hybrid` modes when the team has
 * synthesized answers and we're feeding them back into the next intake
 * attempt.
 *
 * The format surfaces role provenance, explicit assumptions (so the
 * executor can validate them against the repo), and preserved dissent
 * (so a human reviewer can override later). See spec §8.1.
 */
export function augmentRequestWithTeamMeeting(
  originalRequest: string,
  meeting: TeamMeetingResult,
): string {
  const lines: string[] = [
    originalRequest.trim(),
    ``,
    `## Team meeting resolution`,
    ``,
    `The blocking questions were deliberated by a team meeting ` +
      `(${meeting.rolesConvened.join(", ")} + moderator). The team's ` +
      `synthesis is below; commit to these as decisions for this run. ` +
      `The executor will validate the assumptions against the actual repo; ` +
      `surface a follow-up issue for any falsification.`,
    ``,
  ];

  // Per-question synthesized answers with role attribution
  if (meeting.answers.length > 0) {
    lines.push(`### Answers (synthesized)`);
    lines.push(``);
    meeting.answers.forEach((a, i) => {
      lines.push(
        `${i + 1}. **${a.question.trim()}**`,
        `   - **Answer** (${a.sourceRole}, confidence: ${a.confidence}): ${a.answer.trim()}`,
        ``,
      );
    });
  }

  // Assumptions to commit to
  if (meeting.assumptions.length > 0) {
    lines.push(`### Assumptions (commit to these)`);
    lines.push(``);
    meeting.assumptions.forEach((a, i) => {
      const raisedBy = a.raisedBy.join(", ");
      lines.push(
        `${i + 1}. **${a.claim.trim()}**  *(raised by: ${raisedBy})*`,
        `   - Rationale: ${a.rationale.trim()}`,
        `   - Falsifiable by: ${a.falsifiableBy.trim()}`,
        ``,
      );
    });
  }

  // Preserved dissent for audit
  if (meeting.dissent.length > 0) {
    lines.push(`### Dissent recorded`);
    lines.push(``);
    meeting.dissent.forEach((d, i) => {
      lines.push(`${i + 1}. **${d.topic.trim()}**`);
      d.positions.forEach((p) => {
        lines.push(`   - ${p.role}: ${p.position.trim()}`);
      });
      lines.push(`   - Moderator resolution: ${d.resolution.trim()}`);
      lines.push(``);
    });
  }

  // Consensus signal
  lines.push(
    `### Convergence signal`,
    ``,
    meeting.consensus
      ? `The team reached **consensus** with no dissent.`
      : `The team did **not** reach consensus (see dissent above). The ` +
        `moderator chose the synthesis path that minimized risk; flag for ` +
        `human review if any decision feels misaligned.`,
    ``,
    `Mark intake \`readiness: "ready"\` if these answers + assumptions resolve ` +
      `the previous blocking questions. Surface any new blockers only if they ` +
      `are materially different — recurring on the same fractal of detail is ` +
      `the bug this meeting exists to prevent.`,
  );

  return lines.join("\n");
}
