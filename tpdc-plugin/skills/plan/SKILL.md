---
name: plan
description: Convert a validated IntakeArtifact into a typed TPDC PlanArtifact with ordered steps, dependencies (DAG), test commands, and risk assessment. Use after intake when the user asks to "plan it", "break this down", "produce a plan", or as the second step in a /tpdc:ship workflow.
allowed-tools: Read, Grep, Glob, Bash, mcp__plugin_tpdc_tpdc__tpdc_validate_plan_artifact
metadata:
  author: tpdc
  version: "0.4"
---

# TPDC Plan

Decompose a validated intake into a concrete, ordered execution plan. Use the intake context plus repo exploration to draft real steps with binary acceptance criteria and runnable test commands.

## Inputs

- `intake` (object, required): a validated `IntakeArtifact`. Must have `readiness: "ready"` (or `"needs_input"` only if you can plan against the existing AC with explicit blockers).
- `repoRoot` (string, optional): path to the target repo. Defaults to cwd.

## Output

A validated `PlanArtifact` object matching the schema below. Return it to the caller after the MCP validator confirms shape AND semantic invariants (DAG, dependency refs, readiness/steps consistency).

## Workflow

### 0. Note on memory (v0.4)

If the intake came with `assumptions` referencing repo facts (e.g., "Tailwind primary is bg-emerald-600", "tests run via `bun test`"), trust them — they may have been distilled from prior runs via `/memories/repo-facts.md`. You don't need to re-verify, but if your `Read`/`Grep` exploration contradicts an assumption, flag it as a `blocker` so the executor handles the mismatch.

### 1. Re-anchor in the repo

The intake already has problem statement + AC. You still need to understand HOW the change lands in the actual code. Use your tools:

- `Read` the candidate files surfaced in the intake's assumptions / openQuestions (if any).
- `Grep` for similar patterns the change should follow (existing test file structure, existing endpoint naming, etc.).
- `Bash` `cat package.json | jq .scripts` (or equivalent) to find the right test command for this stage.
- `Glob` for related test files so your `testCommands` are realistic.

### 2. Break the intake's AC into ordered steps

For each acceptance criterion in the intake, identify the minimum set of code changes needed. Group related changes into steps. Then order them.

**Step structure rules:**

- Each step has a unique `stepNumber` (1-indexed).
- Each step's `acceptanceCriteria` are a binary subset/refinement of the intake's AC. Not subjective.
- `dependencies` list other stepNumbers that must complete first. Form a **DAG** — no cycles, no self-loops, no references to non-existent step numbers.
- `expectedFiles` is a best-effort list. Empty if genuinely unknowable from the intake alone — the executor refines.
- Granularity: each step should be a single coherent commit-sized change. If you're tempted to split "implement feature X" into 8 sub-steps, ask whether 2-3 broader steps are cleaner.

### 3. Assess risk

Pick `riskLevel` honestly:

- **`low`**: purely additive change with no behavioral effect on existing code paths (new file, new endpoint behind a feature flag, doc updates).
- **`medium`**: modifies existing behavior of a defined area (refactor a component, change a UI affordance, edit an internal API).
- **`high`**: changes shared invariants, security/auth boundaries, data shape (migrations), or system boundaries (public API, contracts with external systems).

Default to **`medium`** if you're between low and medium. Default to **`high`** if you're between medium and high. Optimistic risk assessments lead to dropped review attention.

### 4. Specify validationApproach + testCommands

`validationApproach` is prose describing how a human would verify the work. Cite a real test command, not "verify it works".

`testCommands` are the bash commands the run-tests stage will execute. Each must exit 0 on success. Examples:

- `npm test src/auth/password-reset/`
- `npm run lint`
- `tsc --noEmit`
- `pytest tests/billing/`

If no programmatic validation is possible (manual smoke only), leave `testCommands: []` and note in `validationApproach` that a human smoke is required.

### 5. Decide readiness

- `"ready"`: steps array non-empty, all step AC are binary, dependencies form a DAG. Default expectation if the intake was clean.
- `"needs_input"`: you can draft steps but at least one blocker requires user input (e.g., a design decision the intake didn't lock down). Set `blockers` non-empty with `{ description, resolution }`.
- `"not_ready"`: rare — the intake AC turn out to be unworkable when you try to plan against the real repo. Set blockers explaining what needs to change in the intake before re-planning.

### 6. Validate

Call `mcp__plugin_tpdc_tpdc__tpdc_validate_plan_artifact` with `{ artifact: <your candidate> }`.

- If `ok: true`: return `result.artifact`.
- If `ok: false`: each `errors[i]` has `path`, `message`, and a `code`. The semantic-check codes are:
  - `empty_steps_when_ready` — set readiness to needs_input OR populate steps.
  - `missing_blockers` — when readiness != ready, you must explain why with at least one blocker.
  - `duplicate_step_number` — re-number.
  - `self_dependency` — a step's dependencies must not contain its own stepNumber.
  - `unknown_dependency` — referenced stepNumber doesn't exist in the steps array.
  - `dependency_cycle` — break the cycle by removing one of the back-edges (the message lists the cycle path).

Fix the specific fields named in `path`, then re-call. Iterate up to 3 times. If still invalid, surface errors verbatim and stop.

## Anti-patterns (do NOT do these)

- ❌ Add steps without first reading the candidate files. The plan ends up disconnected from reality.
- ❌ Subjective step AC ("the UI looks better"). Use binary.
- ❌ One mega-step ("Implement everything"). Break it.
- ❌ Eight tiny micro-steps that all touch the same file. Consolidate.
- ❌ Optimistic `riskLevel` (calling a behavior change "low"). Cost: dropped reviewer attention.
- ❌ Empty `testCommands` when programmatic validation is clearly possible (e.g., the repo has a test suite that exercises the area).
- ❌ Skip the validator. Always run it before returning.

## Example (abbreviated)

Given an intake with AC like:

```json
{
  "title": "Improve action button visibility on ProductCard",
  "acceptanceCriteria": [
    "Primary action is rendered with a distinct color and ≥44pt touch target",
    "Secondary actions remain accessible but visually deprioritized",
    "No regression in existing ProductCard tests"
  ],
  "assumptions": ["Tailwind classes are the current styling layer"]
}
```

A good plan (after `Read src/components/ProductCard.tsx` + `cat package.json`):

```json
{
  "title": "Refactor ProductCard action buttons for hierarchy + a11y",
  "objective": "Surface primary action distinctly while keeping secondaries accessible; meet WCAG 2.1 AA touch target size.",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Extract action-button styling tokens into a shared module",
      "description": "Pull the inline Tailwind class strings for the three action buttons into a typed module so primary/secondary variants can be swapped without diff-spaghetti.",
      "acceptanceCriteria": [
        "src/components/ProductCard.actions.styles.ts exports primaryClasses, secondaryClasses, destructiveClasses",
        "ProductCard.tsx imports these instead of inline strings",
        "All existing ProductCard tests still pass"
      ],
      "dependencies": [],
      "expectedFiles": [
        "src/components/ProductCard.actions.styles.ts",
        "src/components/ProductCard.tsx"
      ]
    },
    {
      "stepNumber": 2,
      "title": "Apply visual hierarchy + 44pt touch targets",
      "description": "Use the new tokens: primary uses bg-primary-600 + h-11; secondary uses bg-transparent border + h-11; destructive uses text-red-700.",
      "acceptanceCriteria": [
        "Primary action renders with bg-primary-600 background",
        "All three action buttons render with min-h-[44px]",
        "Visual regression test (if present) passes"
      ],
      "dependencies": [1],
      "expectedFiles": ["src/components/ProductCard.actions.styles.ts"]
    }
  ],
  "riskLevel": "medium",
  "validationApproach": "Run `npm test src/components/` to cover ProductCard tests + smoke the inventory page in dev.",
  "testCommands": ["npm test src/components/"],
  "assumptions": [
    "Existing ProductCard tests cover the action button render. Falsifiable by: Grep for 'ProductCard' in src/components/__tests__/."
  ],
  "blockers": [],
  "readiness": "ready"
}
```

The plan is grounded (file paths from `Read`), the DAG is real (step 2 depends on step 1), AC are binary, riskLevel is honest (changes existing render behavior → medium not low), and `testCommands` references an actual test path the repo supports.
