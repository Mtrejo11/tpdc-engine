---
name: intake
description: Convert a vague feature request into a structured TPDC IntakeArtifact (problem statement, acceptance criteria, scope, open questions). Use when the user asks for a "TPDC intake", "structure this request", "produce an intake artifact", or as the first step in a /tpdc:ship workflow.
allowed-tools: Read, Grep, Glob, Bash, mcp__plugin_tpdc_tpdc__tpdc_validate_intake_artifact, mcp__plugin_tpdc_tpdc__tpdc_team_meeting
metadata:
  author: tpdc
  version: "0.4"
---

# TPDC Intake

Convert a vague feature request into a structured ticket the rest of the TPDC pipeline can act on. Use the repo as context. Ask the human only about what the repo cannot answer.

## Inputs

- `request` (string, required): the user's natural-language description of what they want.
- `repoRoot` (string, optional): path to the target repo. If omitted, default to the current working directory.

## Output

A validated `IntakeArtifact` object matching the schema below. Return it to the caller after the MCP validator confirms shape.

## Workflow

### 0. Check memory first (v0.4+)

If `tpdc_execute` is available in the session AND it's wired into a previous run on this repo, you can leverage prior knowledge via the memory tool. The memory tool is exposed inside `tpdc_execute`'s loop — NOT directly from this skill. So instead of trying to read memory here, the pattern is: **at the end of intake**, optionally suggest repo facts that should be persisted; the executor will store them via `view`/`create` during its agent loop.

If there's a `/memories/repo-facts.md` from a previous run, the executor reads it on the next run. So you don't need to read it during intake — the executor will, and it'll inform downstream stages naturally.

Practically: keep an eye out during exploration for stable repo facts worth persisting. Examples to flag in your intake's `assumptions` or `notes`:

- "ProductCard lives at src/components/ProductCard.jsx" (path that future runs would re-discover otherwise)
- "Test runner is bun + vitest" (framework choice)
- "Tailwind primary color is bg-emerald-600" (design system convention)

These show up in the executor's input via your intake artifact, and the executor can persist them to `/memories/repo-facts.md` if helpful.

### 1. Explore the repo (do this BEFORE asking the human anything)

Use your native tools to gather context. The point is to auto-resolve obvious questions so the human only answers what they alone can answer.

**Minimum exploration checklist:**

- `Read` the repo's `package.json` (or `pyproject.toml` / `go.mod` / etc.) to detect framework, scripts, dependencies.
- `Glob` top-level directories (`src/`, `app/`, `components/`, `pages/`, `lib/`, `test/`) to understand the layout.
- `Grep` for keywords from the request. If the user says "the card component", grep for `Card` in `src/components/`. If "the API endpoint for X", grep for the endpoint path. Surface concrete candidate files.
- `Bash` `git log --oneline -10` for recent commits — useful to see what's been worked on recently and to detect convention drift.

**What this resolves automatically (do NOT ask the human about these):**

- What framework / stack? → `package.json`
- What card component is affected? → `Glob` + `Grep`
- What test runner? → `package.json` scripts
- What platforms? → check for web/mobile/desktop indicators in deps
- What's the current state of the UI? → `Read` the candidate component file
- What naming conventions? → `Grep` similar components

### 2. Ask the human only about the irreducibly-human questions

After exploration, the only things you should ask are:

- **Priority / scope decisions** ("Which of these is the primary action?")
- **Subjective preferences** ("Should we ship a minimal change first or a polished version?")
- **Unknowable constraints** ("Is there an existing design spec we should follow, or is this greenfield?")

When you have a genuine question, use `AskUserQuestion` (Cowork mode) or just ask in chat (standalone Claude Code) with 2-4 concrete options. Don't ask open-ended "what would you like?" questions — anchor with options.

### 3. Build the candidate IntakeArtifact

Match this shape exactly:

```json
{
  "title": "Short title (≤120 chars) summarizing the request",
  "problemStatement": "What hurts and for whom. NO solution language (no 'add', 'build', 'implement'). Frame as a user-facing problem. ≤500 chars.",
  "affectedUsers": "Who experiences this problem (role / segment / specific people). ≤255 chars.",
  "observableSymptom": "Concrete, observable behavior that demonstrates the problem. What does someone see/measure that confirms it? ≤500 chars.",
  "acceptanceCriteria": [
    "Binary, testable criterion 1 (yes/no after execution)",
    "Binary, testable criterion 2"
  ],
  "outOfScope": ["Adjacent thing we're explicitly NOT changing"],
  "assumptions": ["Explicit, falsifiable assumption (the executor will validate)"],
  "openQuestions": [
    {
      "question": "Specific human-only question",
      "owner": "product",
      "blocking": true
    }
  ],
  "readiness": "ready"
}
```

Field rules:

- `title`: 1-120 chars.
- `problemStatement`: 1-500 chars. Frame as a problem statement. **No** "implement", "add", "build", "create" — those describe solutions, not problems.
- `affectedUsers`: 1-255 chars.
- `observableSymptom`: 1-500 chars. Should be observable / measurable, not abstract.
- `acceptanceCriteria`: non-empty array. Each item must be answerable yes/no. No subjective criteria like "looks better".
- `outOfScope`, `assumptions`, `openQuestions`: optional arrays (default to `[]`).
- `openQuestions[].owner`: one of `"product"`, `"engineering"`, `"design"`, `"user"`.
- `openQuestions[].blocking`: `true` if the workflow cannot proceed without an answer.
- `readiness`:
  - `"ready"` — enough info to plan execution.
  - `"needs_input"` — there are blocking openQuestions to resolve first.
  - `"not_ready"` — request is too vague to produce binary acceptance criteria (rare; usually means re-frame with the user).

### 4. Validate

Call `mcp__plugin_tpdc_tpdc__tpdc_validate_intake_artifact` with `{ artifact: <your candidate> }`.

- If response has `ok: true`: return `result.artifact` to the caller (the schema-default-applied version).
- If response has `ok: false`: each `errors[i]` has `path` (e.g., `"openQuestions.0.question"`) and `message`. Fix exactly the fields named in `path`, then re-call the validator. Iterate up to 3 times.

If you can't make the artifact valid after 3 iterations, surface the validation errors verbatim to the user and stop — something about the request is structurally unworkable.

### 5. (Optional) Convene a team meeting on stubborn blockers

If after 2-3 rounds of asking the user clarifying questions the intake still has blocking `openQuestions` that you can't resolve (the user's answers keep surfacing new ambiguity, or they explicitly ask for "what would a PM / Tech Lead / Designer think?"), you can invoke the team-of-agents meeting (D6):

```
mcp__plugin_tpdc_tpdc__tpdc_team_meeting({
  runId: "<runId>",
  originalRequest: "<the user's original request>",
  intakeSoFar: <your current best-effort IntakeArtifact>,
  openQuestions: <the still-blocking subset>,
  rolesToConvene: ["PM", "TechLead", "Engineer", ...(Designer if UI signal)]
})
```

The meeting takes ~60-75s and costs ~$0.30. Returns synthesized `answers` (with role provenance), `assumptions` (commit to these), preserved `dissent`, and possibly `escalateToHuman` if even the team couldn't resolve.

Heuristic for Designer inclusion: include if openQuestions or intake fields mention any of: card, button, color, layout, spacing, contrast, hierarchy, typography, accessibility, ui, ux (English or Spanish equivalents).

Use the meeting's output as augmentation context for one more intake attempt. If the meeting `escalateToHuman` or its assumptions still don't unblock you, halt and surface to the user.

**Don't use the team meeting by default** — only when the user-Claude-Code dialogue has visibly stalled or the user explicitly asks for multi-perspective analysis. It's expensive and slower than a quick direct question.

## Anti-patterns (do NOT do these)

- ❌ Ask the user "what framework is this?" without first reading `package.json`.
- ❌ Ask "which component?" without first running `Glob` + `Grep`.
- ❌ Produce `acceptanceCriteria` that are subjective ("the UI looks better").
- ❌ Set `readiness: "ready"` when you have unresolved blocking openQuestions.
- ❌ Smuggle solution language into `problemStatement` ("Need to add a hover state" — that's a solution, not a problem).
- ❌ Skip the MCP validator. Always validate before returning.

## Example (abbreviated)

User says: *"Mejorar la UI de los action buttons de la card"*

Bad intake (asks the human everything):
> Which card? Which platform? What problems? Got a design spec?

Good intake (after `Glob src/components/*Card*.tsx` + `Read src/components/ProductCard.tsx`):

```json
{
  "title": "Improve action button visibility on ProductCard",
  "problemStatement": "Resellers using the inventory app struggle to distinguish primary from secondary actions on the product card; secondary actions are tapped by accident.",
  "affectedUsers": "Resellers using inventario-reventa, primarily on mobile.",
  "observableSymptom": "Action buttons in src/components/ProductCard.tsx render at the same visual weight, with min touch target below 44pt on narrow screens.",
  "acceptanceCriteria": [
    "Primary action is rendered with a distinct color and ≥44pt touch target",
    "Secondary actions remain accessible but visually deprioritized",
    "No regression in existing ProductCard tests"
  ],
  "outOfScope": ["Restructure of the underlying product data model"],
  "assumptions": [
    "ProductCard is the only card affected (no shared abstraction across other cards). Falsifiable by: Grep for `<Card` in src/components.",
    "Tailwind classes are the current styling layer. Falsifiable by: Read src/components/ProductCard.tsx."
  ],
  "openQuestions": [
    {
      "question": "Which action is primary — 'Mark as sold' or 'Edit'?",
      "owner": "product",
      "blocking": true
    }
  ],
  "readiness": "needs_input"
}
```

The pre-filled detail (component path, current style layer, AC #3 mentioning existing tests) all came from repo exploration. The one openQuestion is irreducibly a product decision.
