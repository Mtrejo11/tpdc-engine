# TPDC — Technical Product Development Cycle

> **Status:** v0.3.0-alpha.6 (pivot in progress to Claude Code plugin + MCP server). The source of truth for architecture is `~/Documents/Claude/Projects/TPDC/VISION.md` in the source repo.

TPDC is an autonomous development workflow that takes a feature request in natural language and produces a PR with CI green. It ships as a **Claude Code plugin** plus an **MCP server** (`tpdc-mcp`). Claude Code orchestrates; TPDC exposes validators + heavy operations as MCP tools and ships skills that instruct Claude Code on how to drive each stage.

## How it works (v0.3)

The pipeline has 8 stages: intake → plan → execute → run-tests → push → open-PR → wait-CI → auto-fix-CI.

Each stage is either:

- A **skill** (markdown in `skills/<stage>/SKILL.md`) — instructs Claude Code on how to do the stage using its native Read/Grep/Glob/Bash tools, with a small TPDC MCP validator at the end to check shape. Used for stages where the agent benefits from full repo context and conversational interaction (intake, plan).
- An **MCP tool** — used for stages that need agentic-and-autonomous loops (execute, run-tests, auto-fix-CI) or parallel coordination (team-meeting). Claude Code calls them and waits.

## Available now (v0.3.0-alpha.6)

| Skill | What it does | Status |
|---|---|---|
| `/tpdc:intake` (via `intake/SKILL.md`) | Convert vague feature request → typed IntakeArtifact. Auto-resolves repo-derivable questions via Read/Grep/Glob. | ✅ available |
| `/tpdc:plan` (via `plan/SKILL.md`) | Convert validated IntakeArtifact → typed PlanArtifact with ordered steps (DAG), riskLevel, testCommands. | ✅ available |
| `/tpdc:auto-fix-ci` (via `auto-fix-ci/SKILL.md`) | After a PR is opened, wait for CI; on failure, fetch logs, run execute in fix-mode, force-push (with confirmation gates), loop up to maxRetries. Composition of wait-CI → fetch-logs → execute → push. | ✅ available |

| MCP tool | What it does |
|---|---|
| `tpdc_ping` | Health check for the MCP server (plugin setup validation). |
| `tpdc_validate_intake_artifact` | Validate a candidate IntakeArtifact against the Zod schema. |
| `tpdc_validate_plan_artifact` | Validate a candidate PlanArtifact against the Zod schema AND semantic invariants (DAG, dependency refs, readiness/steps consistency). |
| `tpdc_execute` | Creates a git worktree, runs the agentic bash + text_editor loop against the validated plan, captures the diff, commits. Returns ExecuteResult JSON. Accepts `existingWorktree` + `failureContext` for fix-mode retries. |
| `tpdc_run_tests` | Runs the plan's `testCommands` sequentially in the worktree. Returns per-command (passed/failed/errored + exit + stdout/stderr) + aggregate status. |
| `tpdc_push` | `git push -u <remote> <branch>` from the worktree. On success, removes the worktree directory (branch ref kept). Force-push-with-lease via `force=true` for auto-fix-CI. |
| `tpdc_open_pr` | `gh pr create` with title/body rendered from intake + plan + execute + (optional) tests. Returns PR URL + number. Status `gh_missing` if gh CLI is not on PATH. Supports `draft` + `wipReason`. |
| `tpdc_wait_ci` | Polls `gh run list` until the most recent run for `branch` reaches a terminal state. Returns conclusion (success/failure/cancelled/...). Exponential backoff (default 5s → 30s cap, max wait 30min). Status `timeout` and `errored` (gh repeatedly failing) are valid outcomes. |
| `tpdc_fetch_ci_logs` | `gh run view --log-failed` for the most recent run on `branch`. Returns tail-preserved log blob (default 8KB cap). Used to feed FailureContext into a fix-mode `tpdc_execute`. |

## Coming next (alpha.7+)

| Stage | Form | Notes |
|---|---|---|
| Top-level "ship a feature" | Skill | Chains intake → plan → execute → run-tests → push → open-PR → auto-fix-ci. The user-facing entry point. |
| Team-of-agents meeting (D6) | MCP tool | Parallel PM/TechLead/Designer/Engineer + Opus moderator when intake doesn't converge. |
| Advisor tool integration | Refactor of execute | Replace manual Opus escalation with the platform's beta advisor tool (VISION.md §4). |
| v1 skills cleanup | Remove deprecated | `develop`, `solve`, `discovery`, `assess`, `fix`, `refactor`, `show`, `diff` directories. |

## Legacy v1 skills (deprecated)

The v1 skills (`develop`, `solve`, `discovery`, `assess`, `fix`, `refactor`, `show`, `diff`) live in this directory but their MCP tool references are stale. They will be cleaned up in a later alpha as the v3 surface fills out. Do not invoke them; use only the v0.3 skills listed above.

(`plan/SKILL.md` has been rewritten for v3 — the v1 version is preserved in git history.)

## Architecture rules

- TPDC commands must be explicitly invoked via slash commands. Do NOT auto-route arbitrary user requests through TPDC.
- For mutation operations (execute, push, open-PR), TPDC MCP tools require explicit consent + a real repo path.
- Skills use Claude Code's native tools (Read, Grep, Glob, Bash) for exploration. MCP tools are for validation and heavy autonomous loops.
- Never apply patches silently — always show diffs and require confirmation.

## Setup

The plugin's `.mcp.json` launches `tpdc-mcp` (the stdio MCP server). The launcher script (`start-mcp.sh`) handles `npm install` if needed. No external server, no webhook, no tunnel — TPDC runs entirely inside Claude Code.

See `VISION.md` for the form-factor lock and capability matrix.
