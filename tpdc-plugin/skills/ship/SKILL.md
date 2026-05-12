---
name: ship
description: TPDC end-to-end — take a feature request in natural language and ship it as a PR with CI green. Orchestrates intake → plan → execute → run-tests → push → open-PR → auto-fix-CI with confirmation gates at the irreversible steps. This is the user-facing entry point for TPDC. Trigger when the user says "ship this feature", "/tpdc:ship", or pastes a feature request expecting an autonomous pipeline.
allowed-tools: Read, Grep, Glob, Bash, mcp__plugin_tpdc_tpdc__tpdc_validate_intake_artifact, mcp__plugin_tpdc_tpdc__tpdc_validate_plan_artifact, mcp__plugin_tpdc_tpdc__tpdc_execute, mcp__plugin_tpdc_tpdc__tpdc_run_tests, mcp__plugin_tpdc_tpdc__tpdc_push, mcp__plugin_tpdc_tpdc__tpdc_open_pr, mcp__plugin_tpdc_tpdc__tpdc_wait_ci, mcp__plugin_tpdc_tpdc__tpdc_fetch_ci_logs
metadata:
  author: tpdc
  version: "0.4"
---

# TPDC Ship — End-to-End Feature Pipeline

The TPDC entry point. Take a natural-language feature request and walk it through the full 8-stage pipeline, presenting the user with summaries and confirmation gates at the irreversible steps (after plan, before push, before auto-fix-CI loop). Returns a PR URL plus the final CI status.

## Inputs

- `request` (string, required): natural-language feature description from the user.
- `repoRoot` (string, optional): absolute path to the target repo. Defaults to the current working directory; verify with `Bash` (`git rev-parse --show-toplevel`) if missing.
- `maxLocalFixRetries` (number, optional): retries for failing local tests via `tpdc_execute` fix-mode. Default `3`.
- `maxCIFixRetries` (number, optional): retries for failing CI runs. Default `3`. Passed to `auto-fix-ci`.
- `baseBranch` (string, optional): PR base. Default `main` (the open-PR stage detects automatically when omitted).
- `draft` (boolean, optional): open PR as draft. Default `false`.

## Output

Return one of:

```json
{
  "status": "success",
  "prUrl": "https://github.com/owner/repo/pull/N",
  "prNumber": N,
  "ciConclusion": "success",
  "localFixRetries": 0,
  "ciFixRetries": 0
}
```

```json
{
  "status": "halted",
  "stage": "intake" | "plan" | "execute" | "run-tests" | "push" | "open-pr" | "auto-fix-ci",
  "reason": "...",
  "context": { ... stage-specific halt context ... }
}
```

Every halt has a `stage` and a concise `reason`. Surface this to the user so they know where to pick up manually.

## Workflow

### Setup

1. Resolve `repoRoot` (use `Bash`: `cd "$repoRoot" && git rev-parse --show-toplevel` to verify it's a git repo).
2. Generate a unique `runId`: `ship-$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 3)` via `Bash`. Use it consistently across all MCP tool calls.
3. Print a one-liner summary for the user:
   - "Starting TPDC ship for runId `<runId>` against `<repoRoot>` (base: `<baseBranch>`)."

### Stage 1 — Intake (delegated to `/tpdc:intake` skill)

**Read** `tpdc-plugin/skills/intake/SKILL.md` and follow its workflow end-to-end:
- Explore the repo with `Read` / `Grep` / `Glob` to auto-resolve obvious questions.
- Ask the user only about irreducibly human decisions.
- Build a candidate `IntakeArtifact`.
- Validate via `mcp__plugin_tpdc_tpdc__tpdc_validate_intake_artifact`. Iterate on errors.

Result: a validated `IntakeArtifact` (the schema-default-applied version from the validator).

If the intake skill itself halted (user aborted, or `readiness: "not_ready"` after exploration), return:

```json
{ "status": "halted", "stage": "intake", "reason": "<reason>", "context": { "lastArtifact": <partial> } }
```

### Stage 2 — Plan (delegated to `/tpdc:plan` skill)

**Read** `tpdc-plugin/skills/plan/SKILL.md` and follow its workflow with the validated intake from stage 1 as the input.

The plan skill includes its own validation via `tpdc_validate_plan_artifact` (including DAG / dependency invariants). Iterate on errors there.

Result: a validated `PlanArtifact`.

#### Gate 1 — review plan before execution

Show the user a compact summary:

- `plan.title`
- `plan.objective` (one paragraph)
- Number of steps + a one-line synopsis of each (`<stepNumber>. <title>`)
- `riskLevel`
- `testCommands` list

Then ask with concrete options (use `AskUserQuestion` in Cowork mode or a 3-option chat question otherwise):

```
"Plan looks ready. How do you want to proceed?
  - Run it as planned     (continue to execute)
  - Tweak the plan first  (let me revise — I'll ask what to change)
  - Stop                  (halt the workflow here)"
```

Branch:
- "Run it as planned" → continue.
- "Tweak the plan first" → ask "What would you like to change?", incorporate the answer, re-run the plan skill with `additionalContext`, validate, return to this gate.
- "Stop" → return `{ status: "halted", stage: "plan", reason: "User stopped after plan review" }`.

### Stage 3 — Execute

Call `mcp__plugin_tpdc_tpdc__tpdc_execute`:

```json
{
  "runId": "<runId>",
  "intakeTitle": "<intake.title>",
  "plan": <plan>,
  "repoRoot": "<repoRoot>"
}
```

Hold onto the returned `ExecuteResult` — you'll need its `worktreePath`, `branch`, `baseSha`, `filesChanged`, `diff` for downstream stages.

Interpret the result:

- **`status: "completed"`** → continue to stage 4.
- **`status: "no_changes"`** → halt with `reason: "Execute produced no changes. The plan may have been a no-op against this repo."`.
- **`status: "max_turns_exceeded"`** → continue, but mark this run as **WIP** (the agent hit the cap but produced a partial commit). Track `wipReason = "Execute halted at max_turns. Output is partial."` for the open-PR stage. Skip stage 4 (don't run tests on partial work). Skip stage 5 (no push). Skip stage 6 (no PR). Return halted.

  Actually: in WIP mode, **do** push as a draft PR so the user has somewhere to inspect the partial work. Adjust the flow: skip to stage 5 with `draft: true` + `wipReason`; skip stage 4; tests will run on the PR itself once opened. Don't auto-fix-CI.

- **`status: "tool_error_loop"` | `"model_refused"`** → halt with that reason; don't push.

### Stage 4 — Run tests (with local auto-fix loop)

Only entered when execute completed cleanly.

`localRetry = 0`

Loop:

1. Call `mcp__plugin_tpdc_tpdc__tpdc_run_tests`:

   ```json
   {
     "runId": "<runId>",
     "worktreePath": "<executeResult.worktreePath>",
     "commands": "<plan.testCommands>"
   }
   ```

2. Interpret:
   - **`status: "all_passed"` | `"no_commands"`** → break the loop, continue to stage 5.
   - **`status: "some_failed"` | `"errored"`**:
     - If `localRetry >= maxLocalFixRetries`: halt the loop. Two options:
       - If the user opted into "ship as WIP draft on failure" (ask if not already set): continue to stage 5 with `wipReason: "Local tests still failing after <N> fix retries."` and `draft: true`.
       - Otherwise: halt with `reason: "Local tests failing after <N> retries. Worktree at <path>."`.
     - Otherwise: invoke fix-mode execute:

       ```json
       {
         "runId": "<runId>",
         "intakeTitle": "<intake.title>",
         "plan": <plan>,
         "repoRoot": "<repoRoot>",
         "existingWorktree": { "path": "...", "branch": "...", "baseSha": "..." },
         "failureContext": {
           "attempt": <localRetry + 1>,
           "previousCommands": [
             /* per-command from the failing run-tests result */
           ],
           "previousFinalSummary": "<executeResult.finalSummary>"
         }
       }
       ```

     - On `status: "completed"`: `localRetry++`, loop back to step 1.
     - On `status: "no_changes" | "max_turns_exceeded" | etc.`: halt with the specific reason.

This is the local equivalent of `auto-fix-ci` but **without** the confirmation gates — local fixes don't affect a remote and the user already approved the plan. The cap is the safety.

### Stage 5 — Push

Call `mcp__plugin_tpdc_tpdc__tpdc_push`:

```json
{
  "runId": "<runId>",
  "repoRoot": "<repoRoot>",
  "worktreePath": "<executeResult.worktreePath>",
  "branch": "<executeResult.branch>"
}
```

- **`status: "pushed"`** → continue to stage 6.
- **`status: "failed"` | `"errored"`** → halt with `reason: "Push failed: <stderr first line>. Likely auth or branch protection. Worktree at <path>; you can push manually."`.

### Stage 6 — Open PR

Call `mcp__plugin_tpdc_tpdc__tpdc_open_pr`:

```json
{
  "runId": "<runId>",
  "repoRoot": "<repoRoot>",
  "branch": "<executeResult.branch>",
  "baseBranch": "<baseBranch>",
  "intake": <intake>,
  "plan": <plan>,
  "execute": <executeResult>,
  "tests": <runTestsResult>,
  "draft": <draft (true if WIP)>,
  "wipReason": "<wipReason if set>"
}
```

- **`status: "opened"`** → continue to gate 2.
- **`status: "gh_missing"`** → halt with `reason: "gh CLI not installed. Install it and run `gh auth login`, then run /tpdc:open-pr to retry from this stage."`.
- **`status: "failed"` | `"errored"`** → halt with that reason.

### Gate 2 — confirm CI auto-fix

Show the user:

- "PR opened: `<prUrl>`"
- "Branch: `<branch>` → base `<baseBranch>`"
- "Risk level: `<plan.riskLevel>`"

Ask:

```
"PR is open. What's next?
  - Wait for CI + auto-fix any failures   (will use /tpdc:auto-fix-ci, up to <maxCIFixRetries> retries)
  - Wait for CI but don't auto-fix        (just monitor; halt on first failure)
  - Stop here                             (PR open, you'll check CI yourself)"
```

Branch:
- **"Wait + auto-fix"** → continue to stage 7.
- **"Wait, don't auto-fix"** → call `tpdc_wait_ci` once. Return with `ciConclusion`. Don't loop.
- **"Stop here"** → return `{ status: "success", prUrl, prNumber, ciConclusion: "skipped", ... }`. The PR is open; the user will handle CI manually.

### Stage 7 — Auto-fix-CI (delegated to `/tpdc:auto-fix-ci` skill)

**Read** `tpdc-plugin/skills/auto-fix-ci/SKILL.md` and follow its workflow with these inputs:

```json
{
  "runId": "<runId>",
  "repoRoot": "<repoRoot>",
  "branch": "<executeResult.branch>",
  "intake": <intake>,
  "plan": <plan>,
  "executeResult": <executeResult>,
  "maxRetries": <maxCIFixRetries>
}
```

The auto-fix-ci skill includes its own confirmation gates per iteration.

Interpret the result:

- **`{ status: "success", retries }`** → return `{ status: "success", prUrl, prNumber, ciConclusion: "success", localFixRetries, ciFixRetries: retries }`.
- **`{ status: "halted", reason, retries, lastLogs? }`** → return:

  ```json
  {
    "status": "halted",
    "stage": "auto-fix-ci",
    "reason": "<auto-fix-ci's reason>",
    "context": { "prUrl": "...", "lastLogs": "...", "ciFixRetries": <retries> }
  }
  ```

  (Note: even on halt, the PR is open and the user can pick up from there.)

## Confirmation gates — why these specific spots

There are **two** explicit user gates in this skill (after plan, after PR open) plus the **two gates per iteration inside auto-fix-ci** (attempt fix? force-push?). That's the minimum to satisfy VISION.md §7.5 ("Never apply patches silently — always show diffs and require confirmation"):

- **Gate 1 (after plan)**: the plan describes what's about to happen to the code. The user gets to revise before any code is written.
- **Gate 2 (after PR open)**: the PR is open and visible. The user gets to choose between a fully-unattended auto-fix loop, a single-shot CI wait, or stopping.

Local test fix-ups (stage 4) don't need a gate because the user already approved the plan and nothing is going to a remote. The cap (`maxLocalFixRetries`) is the safety. If we add gates here too, ship loses its end-to-end flow.

## Anti-patterns

- ❌ Skip the gates by pretending "the user is busy". The whole point of TPDC is to let the user step away — but only after they've signed off on the plan + the PR opening.
- ❌ Push partial WIP without `draft: true` + `wipReason`. The PR template surfaces the WIP warning so reviewers know it's not done.
- ❌ Run auto-fix-CI without the user confirming in gate 2. Force-push without consent is a trust violation.
- ❌ Discard the worktree on halt. The user may want to inspect uncommitted local fixes.
- ❌ Ignore `gh_missing`. It's an infra issue, not a code issue. Surface it clearly so the user can install gh once.

## State across stages — what to carry forward

Keep these in your scratchpad as you progress:

- `runId`
- `repoRoot`, `baseBranch`, `draft` (final, possibly upgraded to true via WIP path)
- `intake` (validated)
- `plan` (validated)
- `executeResult` (post-execute) — this is the source of `worktreePath`, `branch`, `baseSha`
- `runTestsResult` (post-stage-4) — for the PR body
- `localFixRetries` (count, for the final summary)
- `prUrl`, `prNumber` (post-stage-6)
- `wipReason` (only when set)

## Final step — persist the run summary to memory (v0.4)

After the pipeline reaches its terminal state (success OR halted), invoke `tpdc_execute`'s memory tool (or rather: call it via a final lightweight execute step — see below) to write the run summary to `/memories/runs/<runId>.md`. This persists across sessions so the next TPDC run on this repo can see context without re-deriving it.

Actually the cleanest path: persist memory via your last `tpdc_execute` call OR invoke the memory tool indirectly through a final agent turn. If neither is convenient, surface the summary in chat (which you'd do anyway) and note that for v0.5+ we may add a dedicated `tpdc_record_run_event` MCP tool.

Suggested summary file format (`/memories/runs/<runId>.md`):

```markdown
# TPDC run <runId> — <date>

**Outcome:** success | halted (stage: <stage>)
**Request:** "<original user request, verbatim>"
**PR:** <url or "not opened">
**Final CI:** success | failure | timeout | n/a

## Cost roll-up (visible to TPDC)
- tpdc_execute: <inputTokens> in / <outputTokens> out (cache read: <X>, cache create: <Y>)
- tpdc_team_meeting: <inputTokens> in / <outputTokens> out (if fired)
- Other stages: no LLM usage

## Wall-clock (durations from tool results)
- Execute: <durationMs / 1000>s
- Run-tests: <durationMs / 1000>s
- Push: <durationMs / 1000>s
- Open-PR: <durationMs / 1000>s
- Wait-CI: <durationMs / 1000>s
- Auto-fix-CI iterations: <N>

## Retries
- Local fix: <N>/<max>
- CI fix: <N>/<max>

## What shipped
<1-3 sentence description of the actual change>

## Surprises
<bullet list of anything notable: scope-creep avoidance, advisor consultations, halts>

## Memory facts updated
<list any /memories/* files written during this run, e.g., /memories/repo-facts.md additions>
```

Note: the agent will only have visibility into TPDC's MCP-tool token usage. Claude Code's session token consumption (the cost of running intake/plan/auto-fix-ci as skills) is OUTSIDE TPDC's visibility. Don't fabricate those numbers — say "session burn handled by Claude Code; not surfaced to TPDC" if asked.

## Example shape of the final summary you present to the user

On success:

```
✅ TPDC ship complete.
- PR: https://github.com/owner/repo/pull/42
- CI: ✅ green
- Local fix retries: 1 / 3
- CI fix retries: 0 / 3
- Branch: tpdc/run-ship-20260512-103045-a1b2c3
- Worktree (kept for reference): /repo/.tpdc/worktrees/ship-20260512-103045-a1b2c3
```

On halt:

```
⚠️ TPDC ship halted at stage: <stage>.
- Reason: <reason>
- PR: <url or "not opened">
- Recovery: <one-sentence next-step suggestion>
```

## Composition note

This is the user-facing entry. Sub-skills (`/tpdc:intake`, `/tpdc:plan`, `/tpdc:auto-fix-ci`) are intentionally invokable independently for partial workflows. If a user has already produced an intake and just wants planning, they can call `/tpdc:plan` directly — they don't need to go through `/tpdc:ship`. The MCP tools underneath are also directly callable.

`/tpdc:ship` is the simplest path for the happy case: "ship this for me." Everything else is opt-in.
