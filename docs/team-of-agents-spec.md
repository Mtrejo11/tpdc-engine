# Team-of-Agents — Design Spec

*Status: DRAFT — 2026-05-11*
*Context: D6 in `~/Documents/Claude/Projects/TPDC/DECISIONS.md`, alpha.3 pivot.*
*Implements:* the team meeting that deliberates on un-converging intake (and later, plan) loops.

---

## 1. Context

After dogfood-002 (2026-05-08), the intake stage was found to fractalize questions for vague/visual tasks. Each round of unblock answers surfaced new, more specific blockers. The fix shipped in alpha.3-rc1 (bump `maxAttempts` default to 5 + make it configurable per event) buys headroom but doesn't solve the underlying problem: a single intake agent has no mechanism to *deliberate*.

A real dev team handles this by convening voices — product, engineering, design, the implementer themselves — and committing to assumptions explicitly. TPDC = Technical Product Development Cycle. The team-of-agents implements that meeting in software.

This spec covers ONLY the intake meeting. Plan-stage application is a follow-on (see §11).

---

## 2. TL;DR — what we're building

A function `runTeamMeeting(input) → TeamMeetingResult` that:

1. Receives the original request, intake context so far, and open questions.
2. Invokes 4 role agents in parallel (PM, Tech Lead, Designer, Engineer) — each answers the open questions from its role's lens.
3. Invokes 1 moderator agent (Opus 4.6) that synthesizes the 4 outputs into `answers[]`, `assumptions[]`, `dissent[]`, and decides `consensus` / `escalateToHuman`.
4. Returns a structured result that `resolve-intake.ts` consumes as if it were a human's unblock answers — augments the request and re-runs intake one more time.

Single-shot: no recursive meetings. If output is `escalateToHuman`, the workflow falls back to the human-wait path it already has.

---

## 3. Roles

Each role is a separate `runExecutor` call with:
- A role-specific system prompt
- The same user input (intake context + open questions)
- A Zod-typed structured output via `messages.parse()`

### 3.1 PM (Product Manager)

**Lens:** scope, prioritization, user value, acceptance criteria, what to defer.

**Tone:** pragmatic, ROI-aware, asks "what's the simplest thing that delivers user value?"

**System prompt (boceto):**

```
You are the Product Manager voice in a TPDC team meeting.

Your job: read the original request, the intake context gathered so far, and
the open questions that have blocked the intake stage. For each question,
provide YOUR best answer from a product lens.

You care about:
- User-facing value (what does the user actually need?)
- Scope discipline (what can wait for v+1?)
- Acceptance criteria (binary, testable)
- ROI (effort vs. impact)

You do NOT care about:
- Implementation details (that's Tech Lead/Engineer)
- Visual specifics (that's Designer)
- Internal consistency of code (that's Tech Lead)

For each open question, output:
- answer: your best call, framed as a product decision
- confidence: high | medium | low
- assumptions: any product assumptions your answer relies on
- defer: anything you're explicitly punting to v+1

Be opinionated. Commit. If the question is unanswerable from a product
lens, say so explicitly and pass it to another role.
```

**Output shape:** `RoleResponse` (see §5).

### 3.2 Tech Lead

**Lens:** technical feasibility, repo conventions, risks, deuda técnica.

**Tone:** cautious about debt, knows the repo's history, surfaces alternatives.

**System prompt (boceto):**

```
You are the Tech Lead voice in a TPDC team meeting.

Your job: for each open question, provide YOUR best answer from a technical
lens — what's feasible, what's risky, what aligns with existing repo patterns.

You care about:
- Repo conventions and consistency
- Technical debt implications
- Risks (regression, breaking changes, perf)
- Pragmatic alternatives that reduce scope
- Dependencies between this work and other in-flight work

You do NOT care about:
- Whether the user wants this feature (that's PM)
- Pixel-level visual details (that's Designer)

For each open question, output:
- answer: your best technical recommendation
- confidence: high | medium | low
- assumptions: technical assumptions (falsifiable claims about the codebase)
- risks: anything the team should know before committing

Be opinionated. Surface dissent if the PM's likely product direction
would require unacceptable technical cost.
```

### 3.3 Designer

**Lens:** UX, visual hierarchy, consistency with patterns, accessibility.

**Trigger:** only invoked when at least one open question mentions UI/UX/visual concerns, OR the task's `affectedUsers` suggests an end-user-visible change. Otherwise, this role is skipped to save cost (see §6 mode logic).

**System prompt (boceto):**

```
You are the Designer voice in a TPDC team meeting.

Your job: for each open question with visual or UX implications, provide
YOUR best answer from a design lens.

You care about:
- Visual hierarchy (what's primary vs secondary vs tertiary)
- Consistency with existing UI patterns in the repo
- Accessibility (contrast, touch targets, keyboard nav, screen readers)
- Information density (what the user needs to see at this level)

You do NOT care about:
- Whether to build it at all (that's PM)
- How to implement it (that's Engineer)

For each open question that's design-relevant, output:
- answer: your design call, framed as concrete UX guidance
- confidence: high | medium | low
- assumptions: design assumptions (e.g., "users want compact density")
- accessibilityRisks: anything that could fail WCAG AA

For questions NOT in your lens, output `applicable: false` with a brief
reason ("not a design concern: implementation choice").

Be opinionated. If asked "make UI better" with no specifics, COMMIT to
a defensible interpretation (e.g., "increase action button visibility
via higher contrast + larger tap targets") rather than asking back.
```

### 3.4 Engineer (the implementer)

**Lens:** implementer's pragmatism — what's actually buildable from this spec, what's missing, what assumptions would close the gap.

**Tone:** practical, surfaces unstated assumptions, hates ambiguity but commits to defaults.

**System prompt (boceto):**

```
You are the Engineer voice in a TPDC team meeting — you'd be the one
implementing this work.

Your job: for each open question, provide YOUR best answer from the
implementer's lens.

You care about:
- What's actually buildable given the intake context
- Unstated assumptions the spec leaves implicit
- Failure modes / edge cases the spec doesn't address
- Falsifiable claims (so they can be validated in code review)

You do NOT care about:
- Whether to ship it (that's PM)
- Repo-wide architecture concerns (that's Tech Lead)

For each open question, output:
- answer: a concrete commitment you'd be willing to implement against
- confidence: high | medium | low
- assumptions: implementation assumptions, framed as falsifiable claims
  (e.g., "the action buttons are rendered in <Card> at line ~X, using
  Tailwind classes — validating: grep for 'Card' shows the file")
- gapsForFollowUp: things you'd accept implementing now but want flagged
  for a follow-up PR

Be opinionated. Commit. If you absolutely need info to proceed, mark
the question as `requiresHuman: true` with a brief reason.
```

---

## 4. Moderator

**Role:** synthesize the N role responses into one structured result. Decide whether the team converged enough to commit, or whether the disagreement requires escalation to a human.

**Model:** **Opus 4.6** (decided 2026-05-11). Synthesis is the highest-stakes call in the meeting — it's where dissent is preserved or flattened. Cost diff: ~$0.15/meeting (Opus) vs ~$0.05 (Sonnet); quality matters more than $0.10.

**System prompt (boceto):**

```
You are the Moderator of a TPDC team meeting.

You've received responses from N role agents (PM, Tech Lead, Designer,
Engineer) who each answered the same open questions from their role's
lens.

Your job:
1. For each open question, synthesize a single answer that captures the
   team's best collective judgment. Attribute the answer to its source
   role (whoever's lens dominated).
2. Surface assumptions explicitly — both convergent (multiple roles
   agreed) and unique (one role's specific call).
3. PRESERVE DISSENT — if roles disagreed, do NOT flatten. Record the
   disagreement in `dissent[]` so it's auditable by a human.
4. Decide `consensus`:
   - `true` if all roles converged with high/medium confidence and no
     dissent. (Be suspicious — flag if it looks artificial.)
   - `false` otherwise.
5. Decide `escalateToHuman`:
   - Set if: any role marked `requiresHuman: true`, OR dissent involves
     a decision the team cannot resolve without external info, OR
     critical role's confidence is `low` across all open questions.
   - Otherwise: null.

DO NOT invent information. If the team didn't say something, don't
write it. If they collectively don't know, say so via `escalateToHuman`.

Your output is consumed by an autonomous workflow. If `escalateToHuman`
is null, the workflow will commit to your synthesis and proceed.
```

---

## 5. Schemas (Zod)

### 5.1 Input

```ts
export const TeamMeetingInputSchema = z.object({
  runId: z.string(),
  /** Original request from the user (verbatim). */
  originalRequest: z.string().min(1),
  /** Intake context so far — the artifact from the last attempt. */
  intakeSoFar: IntakeArtifactSchema,
  /** Which open questions to deliberate on. Pulled from intakeSoFar.openQuestions
   *  where blocking === true. We pass them separately so the prompt is direct. */
  openQuestions: z.array(OpenQuestionSchema).min(1),
  /** Which roles to convene. Designer skipped when the task has no visual
   *  signal. */
  rolesToConvene: z.array(
    z.enum(["PM", "TechLead", "Designer", "Engineer"]),
  ).min(2),
});
export type TeamMeetingInput = z.infer<typeof TeamMeetingInputSchema>;
```

### 5.2 Role response (each agent)

```ts
const RoleQuestionAnswerSchema = z.object({
  question: z.string().min(1),
  applicable: z.boolean(),
  answer: z.string().min(1).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  assumptions: z.array(z.string()).default([]),
  /** Role-specific fields surface here. */
  notes: z.string().optional(),
  requiresHuman: z.boolean().default(false),
  requiresHumanReason: z.string().optional(),
});

export const RoleResponseSchema = z.object({
  role: z.enum(["PM", "TechLead", "Designer", "Engineer"]),
  answers: z.array(RoleQuestionAnswerSchema).min(1),
  /** Role-specific extra fields (e.g., risks for TechLead, accessibilityRisks
   *  for Designer). Free-form for now; tighten if needed. */
  roleSpecific: z.record(z.unknown()).optional(),
});
export type RoleResponse = z.infer<typeof RoleResponseSchema>;
```

### 5.3 Moderator output (final)

```ts
const SynthesizedAnswerSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sourceRole: z.enum(["PM", "TechLead", "Designer", "Engineer", "synthesis"]),
  confidence: z.enum(["high", "medium", "low"]),
});

const SynthesizedAssumptionSchema = z.object({
  claim: z.string().min(1),
  rationale: z.string().min(1),
  /** How the executor stage would validate this in code. */
  falsifiableBy: z.string().min(1),
  /** Which role(s) raised this assumption. */
  raisedBy: z.array(z.enum(["PM", "TechLead", "Designer", "Engineer"])).min(1),
});

const DissentSchema = z.object({
  topic: z.string().min(1),
  positions: z.array(
    z.object({
      role: z.enum(["PM", "TechLead", "Designer", "Engineer"]),
      position: z.string().min(1),
    }),
  ).min(2),
  resolution: z.string().describe(
    "How the moderator resolved this dissent (or 'unresolved' if escalating).",
  ),
});

export const TeamMeetingResultSchema = z.object({
  runId: z.string(),
  answers: z.array(SynthesizedAnswerSchema),
  assumptions: z.array(SynthesizedAssumptionSchema).default([]),
  dissent: z.array(DissentSchema).default([]),
  consensus: z.boolean(),
  escalateToHuman: z.object({
    reason: z.string().min(1),
  }).nullable(),
  /** Per-role token usage for cost tracking. */
  usage: z.object({
    PM: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    TechLead: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    Designer: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    Engineer: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    moderator: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  }),
});
export type TeamMeetingResult = z.infer<typeof TeamMeetingResultSchema>;
```

---

## 6. Modes

Three modes determine when the team meeting fires.

| Mode | Behavior |
|---|---|
| `manual` | Never auto-delegates. Always waits for the human via `step.waitForEvent`. Status quo before D6. |
| `auto` | Always delegates to the team meeting after the first `needs_input` (no human wait at all). Useful for fully unattended CI runs. |
| `hybrid` (default) | Tries human first via `waitForEvent` with a *short* timeout (e.g., 30 min). On timeout, delegates to team. On a longer timeout (e.g., 1 day default), halts. |

**Default mode: `hybrid`** (decided 2026-05-11). Preserves the human as first-class decider when available; doesn't block the workflow when afk.

**Hybrid short-timeout: `30m` default**, configurable via `teamMeetingHybridTimeout` per event. Long enough for a human at keyboard; short enough that unattended runs don't stall.

### Mode wiring

```ts
// FeatureRequestedSchema extension (already has intakeMaxAttempts)
{
  ...,
  teamMeetingMode: z.enum(["manual", "auto", "hybrid"]).default("hybrid"),
  teamMeetingHybridTimeout: z.string().default("30m"),  // Inngest format
}
```

---

## 7. Integration in `resolve-intake.ts`

Today's flow (alpha.3-rc1):

```
loop attempt 1..maxAttempts:
  run intake
  if ready → return
  if not_ready → halt
  if needs_input with blocking q's:
    emit unblock_requested
    waitForEvent intake.unblocked (1d timeout)
    on resume: augment request, retry
    on timeout: halt
```

D6 flow (this spec):

```
loop attempt 1..maxAttempts:
  run intake
  if ready → return
  if not_ready → halt
  if needs_input with blocking q's:
    if mode == "manual":
      [existing flow — emit + waitForEvent 1d + augment]
    else if mode == "auto":
      runTeamMeeting → augment with synthesized answers, retry
    else if mode == "hybrid":
      emit unblock_requested
      waitForEvent intake.unblocked (short timeout, e.g. 30m)
      if event arrived:
        augment with human's answers, retry
      else (timeout):
        runTeamMeeting → if escalateToHuman: fall back to long human wait
                       else: augment with synthesized answers, retry
```

**Crucial invariant:** the team meeting is invoked AT MOST ONCE per intake run. After the team has synthesized, the next attempt runs intake; if intake STILL halts, we halt the workflow with `kind: "halted"` and `reason` mentioning that the team meeting didn't unblock convergence. No recursive team meetings.

**Meeting cap: 1 per intake unblock loop, hard cap.** If the team's synthesis doesn't make intake converge on the next attempt, halt (and surface both outputs for human review to override).

### Trigger condition

The meeting triggers when `mode != "manual"` AND `attempt > N` AND `blocking.length > 0`.

**N (attempt threshold to trigger): `N=2`** (decided 2026-05-11). So the loop is:
- Attempt 1: try intake fresh
- Attempt 2: try intake with human unblock (if any)
- Attempt 3: still blocking → team meeting fires (hybrid: human gets 30m first), augment, retry one last time
- Attempt 4: if still blocking → halt with both human + team outputs in lastArtifact

This gives `maxAttempts=5` (the new default) enough headroom: 2 organic attempts, 1 meeting attempt, 1 post-meeting attempt, 1 final.

---

## 8. Decision provenance

The team's output must be auditable. Three places it surfaces:

### 8.1 Augmented intake request (next attempt)

When the team's answers are fed back into intake, the format is similar to today's `augmentRequestWithAnswers` but with role attribution:

```markdown
## Team meeting resolution

Original blocking questions were deliberated by a team meeting (PM, Tech
Lead, Designer, Engineer + moderator). Results:

### Question: "Should the action buttons be more prominent?"
**Answer (from Designer):** Increase visual weight via primary-color
background + 12% larger size + min 44pt touch target.
**Confidence:** medium

### Assumptions made (commit to these)
1. The card has 2-3 action buttons currently rendered in a horizontal row.
   *Falsifiable by:* grep for the card component in src/components.
2. The design system uses Tailwind primary-* tokens.
   *Falsifiable by:* grep for primary-500 / primary-600 in CSS.

### Dissent recorded
- PM said "ship minimal change first, validate"
- Designer pushed for richer treatment
- Moderator resolution: side with PM (minimal), defer Designer's richer
  proposal to a v+1 follow-up issue.

Take these as committed. The executor will validate the assumptions
against the actual repo; surface a follow-up issue for any falsification.
```

This gets prepended to the user input on the next intake attempt.

### 8.2 IntakeArtifact (final)

The final `IntakeArtifact` returned by `resolveIntakeWithUnblock` carries:
- `assumptions[]` includes the team's synthesized assumptions (prefixed `[team] ...` so they're distinguishable from intake's own assumptions in PR description rendering)
- A new optional field on the result (NOT the artifact): `teamMeeting?: TeamMeetingResult` — opaque to downstream stages but accessible to logging / PR body templates

**Surface team meeting to PR description: YES** (decided 2026-05-11). PR body should have a "Team Meeting" section when one fired, with `consensus`, `dissent`, and `escalateToHuman` (if any) summarized. Helps reviewers understand why certain calls were made.

### 8.3 Inngest UI / logging

Emit a new event `tpdc/team-meeting.completed` with the TeamMeetingResult payload. Visible in Inngest UI for mid-flight inspection, audit-after-the-fact.

---

## 9. Edge cases & escalation

| Scenario | Behavior |
|---|---|
| All 4 roles return `applicable: false` for all questions | Moderator returns `escalateToHuman: { reason: "no role found this answerable" }` |
| Moderator marks `escalateToHuman` | Workflow falls back to long human wait (the original `waitForEvent` path with 1d timeout). |
| Team meeting itself errors (e.g., API timeout for a role) | Catch in `team-meeting.ts`, return null. `resolve-intake` falls back to human wait path. |
| `consensus: true` but all confidences are `low` | Workflow proceeds but logs a warning. (Don't block on it — low confidence is expected for vague tasks.) |
| Designer role triggered but task has no UI signal | Designer self-reports `applicable: false` for all questions; moderator notes the absent voice in dissent if relevant. |
| Cost cap hit (more than 1 meeting attempted) | Hard error in `resolve-intake`. We never recurse. |
| Team's synthesized answers cause intake to STILL halt next attempt | `resolveIntakeWithUnblock` returns `halted` with `reason: "team meeting did not resolve convergence; lastArtifact + teamMeeting attached for review"`. |

---

## 10. Tests strategy

### 10.1 Unit (mocked, fast, run in CI)

- `team-meeting.test.ts`: mock `runExecutor` to return canned `RoleResponse`s. Verify:
  - All 4 roles get invoked when `rolesToConvene` includes all.
  - Designer is skipped when `rolesToConvene` excludes it.
  - Moderator gets the right input shape (the 4 role outputs as user content).
  - The final `TeamMeetingResult` has correct shape and aggregated usage.
- Role-specific tests for response parsing (e.g., Designer returns `applicable: false` correctly).
- Moderator tests:
  - Consensus detection (all roles converge → `consensus: true`).
  - Dissent preservation (roles disagree → `dissent[]` populated).
  - Escalation (any role marks `requiresHuman: true` → `escalateToHuman` set).

- `resolve-intake.test.ts` extensions:
  - Mode `manual`: existing flow, unchanged.
  - Mode `auto`: team meeting fires immediately on first `needs_input`.
  - Mode `hybrid`: human-first with short timeout; on timeout, team fires.
  - Team meeting result augments next intake attempt.
  - Team's `escalateToHuman` falls back to long human wait.
  - Hard cap: 2nd team meeting attempt errors out (defense).

### 10.2 Integration (gated by `ANTHROPIC_API_KEY`)

- 1 end-to-end test: real meeting with simulated open questions for a vague visual task. Verify shape of output (don't assert specific content — model is non-deterministic).
- Goal: catch prompt drift / schema drift early.

### 10.3 Smoke (manual, against real repo)

After build sessions, re-smoke against `Mtrejo11/inventario-reventa` with the same task that failed dogfood-002 ("Mejorar la UI de los action buttons de la card"). Success criteria:
1. Intake reaches the team meeting trigger.
2. Team meeting returns `escalateToHuman: null` and `consensus: true | false` (either is fine — what matters is convergence).
3. Plan stage proceeds (no halt in intake).
4. Execute reaches completion or hits a different (non-intake) failure.
5. Cost stays under $1 for the full run.

---

## 11. Out of scope (deferred)

These don't ship with the intake team meeting:

1. **Plan-stage team meeting.** Same pattern likely applies, but we validate intake first. Apply to plan in a follow-on once intake is proven.
2. **Configurable role sets.** For now, 4 roles fixed (with Designer auto-skipped on non-UI signal). Future: per-task-type role sets (e.g., "infra refactor" → +SRE -Designer).
3. **Role-on-role pushback.** The roles see the input independently; they don't see each other's outputs. Future: a 2-round meeting where roles see initial responses + can revise (potential cost 2x; not worth it before we validate v1).
4. **Persistent meeting state.** Each meeting is independent. Future: a meeting could reference prior meetings (e.g., "PM said X last week, still applies"). Out of scope.
5. **Per-workspace role customization.** All TPDC workflows use the same role prompts. Future: per-repo `.tpdc/roles/*.md` for org-specific role tuning.
6. **Human-in-the-team mode.** Future option where a human is one of the roles. Out of scope.

---

## 12. Decisions ratificadas (2026-05-11)

All 8 open decisions resolved. Mauricio approved the 4 high-stakes ones via AskUserQuestion; the 4 minor ones default to the spec's recommendations (override anytime in the build sessions).

| # | Decision | Resolved | Rationale |
|---|---|---|---|
| 1 | Moderator model | **Opus 4.6** ✅ | Synthesis is highest-stakes; $0.10 diff vs Sonnet is worth quality. (§4) |
| 2 | Default mode | **`hybrid`** ✅ | Human-first when available, team fallback on short timeout. (§6) |
| 3 | Hybrid short-timeout | **`30m`** (default) | Configurable via `teamMeetingHybridTimeout` per event. (§6) |
| 4 | N attempt threshold | **`N=2`** ✅ | Intake fresh → human unblock → team on attempt 3. Conservative. (§7) |
| 5 | Meeting cap per intake loop | **1 hard cap** (default) | If team meeting doesn't unblock, halt and surface both outputs to human. (§7) |
| 6 | Surface to PR description | **Yes** ✅ | Auditable post-hoc; reviewer understands why calls were made. (§8.2) |
| 7 | Designer auto-skip | **Keyword-match** (default) | Skip when no UI/visual signal in openQuestions text. Saves cost on non-UI tasks. (§3.3) |
| 8 | `rolesToConvene` min | **2** (default) | Allows lean meetings; PM + one specialist is a valid quorum. (§5.1) |

Folder naming (§14): **`src/teams/`** (default). Leaves room for `intake-meeting.ts` / `plan-meeting.ts` later if patterns diverge.

---

## 13. Cost & latency budget

Per meeting (4 roles + moderator), assuming inputs ~3k tokens, outputs ~1k tokens:

| Agent | Model | Cost (USD) |
|---|---|---|
| PM | Sonnet 4.6 | ~$0.04 |
| TechLead | Sonnet 4.6 | ~$0.04 |
| Designer | Sonnet 4.6 | ~$0.04 (when invoked) |
| Engineer | Sonnet 4.6 | ~$0.04 |
| Moderator | Opus 4.6 | ~$0.15 |
| **Total** | | **~$0.27–0.31** per meeting |

Latency: roles run in parallel (~30-45s), moderator runs after (~20-30s). Total ~60-75s per meeting.

Compared to: a stuck workflow ($0 immediate cost but indefinite blocking) or a human responder (15-30 min latency). Cost is a strong trade.

---

## 14. File layout (proposed)

```
src/teams/
  schemas.ts            # TeamMeetingInput, RoleResponse, TeamMeetingResult
  role-prompts.ts       # PM_SYSTEM_PROMPT, TECH_LEAD_SYSTEM_PROMPT, ...,
                        # MODERATOR_SYSTEM_PROMPT (all exported strings)
  team-meeting.ts       # runTeamMeeting(input) → TeamMeetingResult
                        # Calls runExecutor 4 (or N) times in parallel, then
                        # the moderator. Self-contained, no Inngest dep.
  team-meeting.test.ts  # unit tests
  team-meeting.integration.test.ts  # gated integration

src/inngest/workflows/lib/
  resolve-intake.ts     # MODIFIED: branches on mode, calls runTeamMeeting
                        # on auto/hybrid-timeout
  resolve-intake.test.ts  # extended with mode coverage
```

**Folder naming: `src/teams/`** (default, override anytime). Short and accurate; leaves room for `intake-meeting.ts` / `plan-meeting.ts` later.

---

## 15. Build session plan (subset of HANDOFF)

**Session 2 — Build 1: schemas + helper standalone**

- `src/teams/schemas.ts`
- `src/teams/role-prompts.ts`
- `src/teams/team-meeting.ts` (the helper, no Inngest)
- `src/teams/team-meeting.test.ts` (unit, ~6-8 tests)
- Run typecheck + tests. Commit.

**Session 3 — Build 2: integration**

- `events.ts`: add `teamMeetingMode`, `teamMeetingHybridTimeout` to FeatureRequestedSchema
- `events.ts`: add `tpdc/team-meeting.completed` event schema
- `client.ts`: register new event
- `resolve-intake.ts`: mode-aware branching, team meeting invocation, fallback logic
- `resolve-intake.test.ts`: new test cases per §10.1
- `ship-feature.ts`: pass through new event fields
- Run typecheck + tests. Commit.

**Session 4 — Validation**

- Tag `v0.2.0-alpha.3` (drops the `-rc1` once team meeting is in)
- Re-smoke against `inventario-reventa` per §10.3
- Document results in HANDOFF; close TODO #21, #22

---

*End of spec — DRAFT, awaiting Mauricio's review of §12 open decisions.*
