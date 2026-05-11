---
name: auto-fix-ci
description: After a TPDC PR is opened, wait for CI; if it fails, fetch logs, run execute in fix-mode, force-push the fix, and re-wait. Loops up to maxRetries times with confirmation gates. Use after /tpdc:open-pr or as the tail of /tpdc:ship.
allowed-tools: Read, Bash, mcp__plugin_tpdc_tpdc__tpdc_wait_ci, mcp__plugin_tpdc_tpdc__tpdc_fetch_ci_logs, mcp__plugin_tpdc_tpdc__tpdc_execute, mcp__plugin_tpdc_tpdc__tpdc_push
metadata:
  author: tpdc
  version: "0.3"
---

# TPDC Auto-Fix CI

Compose the four CI-recovery MCP tools (`tpdc_wait_ci`, `tpdc_fetch_ci_logs`, `tpdc_execute` in fix-mode, `tpdc_push --force`) into a bounded loop that responds to CI failures the way a thoughtful dev would: inspect logs, propose a fix, present the diff, force-push only after confirmation.

This is **not** a monolithic "fix it autonomously" tool. It is an orchestration that requires the user's eyes at two checkpoints per iteration. The point is to leverage TPDC's machinery for the mechanical parts while keeping the human as the quality gate for code changes that land on a remote branch.

## Inputs

- `runId` (string, required): TPDC run identifier from upstream stages.
- `repoRoot` (string, required): absolute path to the repo.
- `branch` (string, required): the branch that was pushed (head ref of the PR).
- `intake` (object, required): validated `IntakeArtifact` from earlier in the pipeline.
- `plan` (object, required): validated `PlanArtifact`.
- `executeResult` (object, required): the result of the original `tpdc_execute` — provides `worktreePath`, `branch`, `baseSha` for fix-mode reuse.
- `headSha` (string, optional): commit SHA the original PR pushed. Used to match the CI run precisely (helpful after force-push retries).
- `prNumber` (number, optional): for surfacing context in messages.
- `maxRetries` (number, optional): cap on fix iterations. Default `3`.

## Output

Return one of:

```json
{ "status": "success", "conclusion": "CI green", "retries": <N>, "url": "<run url>" }
```

```json
{ "status": "halted", "reason": "...", "retries": <N>, "lastLogs": "..." (optional) }
```

`status: "halted"` covers all non-success outcomes: timeout, max-retries reached, user aborted at a confirmation gate, gh errored, etc. Always include a concise `reason` so the caller (or downstream `/tpdc:ship` orchestration) can decide what to do next.

## Workflow

### State

Track these across iterations (you can keep them in your scratch context):

- `retry` (starts at 0)
- `currentHeadSha` (starts at `headSha` if provided; updates each force-push)
- `lastLogs` (set on each failure; preserved for the halt summary)

### Loop

Repeat until success, halt, or `retry >= maxRetries`:

#### 1. Wait for CI

Call `mcp__plugin_tpdc_tpdc__tpdc_wait_ci`:

```json
{
  "runId": "<runId>",
  "repoRoot": "<repoRoot>",
  "branch": "<branch>",
  "headSha": "<currentHeadSha if known>"
}
```

Interpret the result:

- **`status: "completed"` + `conclusion: "success"`** → return `{ status: "success", conclusion: "CI green", retries: <retry>, url: <result.url> }`. Done.
- **`status: "completed"` + `conclusion: "failure"`** → continue to step 2.
- **`status: "completed"` + `conclusion: "cancelled"` | `"skipped"` | `"action_required"`** → halt with that specific reason. Don't try to fix something that wasn't a real failure.
- **`status: "timeout"`** → halt with `reason: "CI did not finish within <X>m. PR is left as-is for human review."`. Surface the PR URL.
- **`status: "errored"`** → halt with `reason: "gh CLI failed repeatedly (<lastErrorMessage>). Likely auth / PATH issue. PR is unmodified."`. Don't loop on infra problems.

#### 2. Fetch failing logs

Call `mcp__plugin_tpdc_tpdc__tpdc_fetch_ci_logs`:

```json
{ "repoRoot": "<repoRoot>", "branch": "<branch>" }
```

- If `ok: true`: store `result.logs` in `lastLogs`.
- If `ok: false`: report `result.errorMessage` to the user. You can still attempt a fix — pass an empty failure context — but flag explicitly that the agent is fixing blind.

#### 3. Show the user, ask for confirmation to attempt a fix

Summarize for the user in chat:

- Retry number (`<retry+1>` of `<maxRetries>`)
- The workflow name + URL from the wait-CI result
- A short excerpt of the logs (max ~500 chars, prefer the tail where the actual error usually is). Use a fenced code block.
- A one-line guess at the root cause if you can extract it from the logs (test name, lint rule, type error file:line). If you can't, say so.

Then ask the user explicitly with `AskUserQuestion` (or in chat with 2 options):

```
"Attempt an autonomous fix?
  - Yes, try a fix         (TPDC will run execute in fix-mode + force-push)
  - No, halt for review    (PR stays as-is)"
```

If the user picks halt: return `{ status: "halted", reason: "User opted to review manually", retries: <retry>, lastLogs }`.

#### 4. Run execute in fix-mode

Call `mcp__plugin_tpdc_tpdc__tpdc_execute`:

```json
{
  "runId": "<runId>",
  "intakeTitle": "<intake.title>",
  "plan": <plan>,
  "repoRoot": "<repoRoot>",
  "existingWorktree": {
    "path": "<executeResult.worktreePath>",
    "branch": "<executeResult.branch>",
    "baseSha": "<executeResult.baseSha>"
  },
  "failureContext": {
    "attempt": <retry + 1>,
    "previousCommands": [
      {
        "command": "<the failing CI workflow's main test command, or 'CI'>",
        "exitCode": 1,
        "stdout": "",
        "stderr": "<truncated lastLogs>"
      }
    ],
    "previousFinalSummary": "<executeResult.finalSummary>"
  }
}
```

Interpret the result:

- **`status: "completed"`** with new `filesChanged` → continue to step 5.
- **`status: "no_changes"`** → halt with `reason: "Execute fix-mode produced no diff. The failure may be environmental (CI infrastructure, secrets) rather than code. Recommend human review."`.
- **`status: "max_turns_exceeded"` | `"tool_error_loop"` | `"model_refused"`** → halt with the specific reason. Don't force-push half-baked work.

#### 5. Show the user the proposed diff, ask for confirmation to force-push

Present in chat:

- Short summary from `executeResult.finalSummary` (the new one).
- The diff (or first ~80 lines + "(N more lines)").
- Files changed list.

Ask explicitly:

```
"Force-push this fix to <branch>?
  - Yes, push the fix       (force-push-with-lease; CI will re-run)
  - No, leave it local      (commit stays in worktree; you can inspect)"
```

If the user picks "leave it local": return `{ status: "halted", reason: "Fix committed locally but not pushed. Worktree retained for review at <executeResult.worktreePath>", retries: <retry + 1>, lastLogs }`.

#### 6. Force-push

Call `mcp__plugin_tpdc_tpdc__tpdc_push`:

```json
{
  "runId": "<runId>",
  "repoRoot": "<repoRoot>",
  "worktreePath": "<executeResult.worktreePath>",
  "branch": "<branch>",
  "force": true
}
```

Interpret:

- **`status: "pushed"`** → update `currentHeadSha` to the new commit SHA (you can pull it from `executeResult.commitSha` of the fix-mode run if available, or skip the SHA and let `tpdc_wait_ci` match on branch alone). Increment `retry`. Loop back to step 1.
- **`status: "failed"`** → halt. `reason: "force-push failed (<stderr first line>). Likely branch protection or upstream changes; manual intervention required."`.
- **`status: "errored"`** → halt with the error message.

#### 7. Max retries hit

If `retry >= maxRetries` after a failed iteration: halt with `reason: "Reached maxRetries (<maxRetries>) without CI green. PR is left as-is with the latest attempt's commit. Recommend marking as draft for human review."`.

## Confirmation gates rationale

There are two gates per iteration (at steps 3 and 5). Both are deliberate:

- **Gate 3 (attempt a fix?)** prevents wasting tokens + CI minutes on failures the user wants to investigate themselves (e.g., test flakes, environment issues).
- **Gate 5 (force-push?)** is the irreversible action. Force-push-with-lease is safer than `--force`, but the user should still see what's landing on the remote.

If users want fully unattended retries (e.g., overnight runs), they can pre-approve with a flag. For now, default is interactive.

## Anti-patterns

- ❌ Skip the confirmation gates and force-push silently. Use of `--force` without a user's eyes on the diff is exactly the kind of trust violation that gets autonomous dev tools shut down.
- ❌ Loop forever ignoring `maxRetries`. The 3-attempt cap is the floor; never exceed it without a user override.
- ❌ Attempt a fix when `conclusion` is `cancelled` or `action_required`. Those are signals from CI/humans, not code bugs.
- ❌ Discard the worktree on halt. Keep it for human investigation — the user may want to inspect the local commits, even if they didn't push.
- ❌ Force-push without `--force-with-lease`. The `force=true` flag on `tpdc_push` uses lease semantics; never bypass that.

## Example state across iterations

```
retry=0 → wait → failure → fetch logs → ask user → attempt fix → execute → show diff → push (force) → retry=1
retry=1 → wait → success → return { status: "success", retries: 1 }
```

Or:

```
retry=0 → wait → failure → fetch logs → ask user → user says halt → return { status: "halted", reason: "User opted to review manually", retries: 0 }
```

Or:

```
retry=0 → wait → failure → fetch logs → fix → push → retry=1 → wait → failure → fix → push → retry=2 → wait → failure → fix → push → retry=3 → max hit → return { status: "halted", reason: "Reached maxRetries..." }
```

## Composition note

This skill is the **CI half** of the TPDC pipeline. The pre-CI pipeline (intake → plan → execute → run-tests → push → open-PR) is the responsibility of the upstream skills + MCP tools. The top-level `/tpdc:ship` skill (alpha.7) will compose both halves: call the upstream stages, then call this skill on the resulting PR.
