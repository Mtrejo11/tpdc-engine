# TPDC — Technical Product Development Cycle

> **Status:** **v0.4.0-alpha.1** — v0.3.0 shipped (form-factor pivot validated); v0.4 chapter adding capabilities: **prompt caching** (alpha.0) + **memory tool** (alpha.1). The source of truth for architecture is `~/Documents/Claude/Projects/TPDC/VISION.md` in the source repo.

TPDC is an autonomous development workflow that takes a feature request in natural language and produces a PR with CI green. It ships as a **Claude Code plugin** plus an **MCP server** (`tpdc-mcp`). Claude Code orchestrates; TPDC exposes validators + heavy operations as MCP tools and ships skills that instruct Claude Code on how to drive each stage.

## Quick start

```
/tpdc:ship "Add a password reset flow"
```

The `/tpdc:ship` skill walks the request through the full pipeline (intake → plan → execute → run-tests → push → open-PR → auto-fix-CI) with confirmation gates at the irreversible steps. Returns a PR URL + CI status.

For partial workflows, you can invoke any sub-skill or MCP tool directly — they're all standalone.

## How it works (v0.3)

The pipeline has 8 stages: intake → plan → execute → run-tests → push → open-PR → wait-CI → auto-fix-CI.

Each stage is either:

- A **skill** (markdown in `skills/<stage>/SKILL.md`) — instructs Claude Code on how to do the stage using its native Read/Grep/Glob/Bash tools, with a small TPDC MCP validator at the end to check shape. Used for stages where the agent benefits from full repo context and conversational interaction (intake, plan).
- An **MCP tool** — used for stages that need agentic-and-autonomous loops (execute, run-tests, auto-fix-CI) or parallel coordination (team-meeting). Claude Code calls them and waits.

## Available now (v0.3.0-alpha.7)

| Skill | What it does | Status |
|---|---|---|
| **`/tpdc:ship`** (via `ship/SKILL.md`) | **End-to-end pipeline.** Take a natural-language feature request → produce a PR with CI green. Orchestrates intake → plan → execute → run-tests → push → open-PR → auto-fix-CI. Two confirmation gates (after plan, after PR open) + the auto-fix-ci skill's own gates. The user-facing entry point. | ✅ available |
| `/tpdc:intake` (via `intake/SKILL.md`) | Convert vague feature request → typed IntakeArtifact. Auto-resolves repo-derivable questions via Read/Grep/Glob. | ✅ available |
| `/tpdc:plan` (via `plan/SKILL.md`) | Convert validated IntakeArtifact → typed PlanArtifact with ordered steps (DAG), riskLevel, testCommands. | ✅ available |
| `/tpdc:auto-fix-ci` (via `auto-fix-ci/SKILL.md`) | After a PR is opened, wait for CI; on failure, fetch logs, run execute in fix-mode, force-push (with confirmation gates), loop up to maxRetries. Composition of wait-CI → fetch-logs → execute → push. | ✅ available |

| MCP tool | What it does |
|---|---|
| `tpdc_ping` | Health check for the MCP server (plugin setup validation). |
| `tpdc_validate_intake_artifact` | Validate a candidate IntakeArtifact against the Zod schema. |
| `tpdc_validate_plan_artifact` | Validate a candidate PlanArtifact against the Zod schema AND semantic invariants (DAG, dependency refs, readiness/steps consistency). |
| `tpdc_execute` | Creates a git worktree, runs the agentic bash + text_editor + **memory** + **advisor** loop against the validated plan, captures the diff, commits. **Memory tool** (beta `memory_20250818`) gives the agent a persistent `/memories/` dir at `<repoRoot>/.tpdc/memory/` that survives across runs — repo facts, run summaries, falsified assumptions. **Advisor tool** (Opus 4.7, server-side, cap 5/run) integrated via beta `advisor-tool-2026-03-01`. **Prompt caching** caches the (system + tools) prefix per turn (0.1x base rate on reads). Returns ExecuteResult JSON. Accepts `existingWorktree` + `failureContext` for fix-mode retries. |
| `tpdc_run_tests` | Runs the plan's `testCommands` sequentially in the worktree. Returns per-command (passed/failed/errored + exit + stdout/stderr) + aggregate status. |
| `tpdc_push` | `git push -u <remote> <branch>` from the worktree. On success, removes the worktree directory (branch ref kept). Force-push-with-lease via `force=true` for auto-fix-CI. |
| `tpdc_open_pr` | `gh pr create` with title/body rendered from intake + plan + execute + (optional) tests. Returns PR URL + number. Status `gh_missing` if gh CLI is not on PATH. Supports `draft` + `wipReason`. |
| `tpdc_wait_ci` | Polls `gh run list` until the most recent run for `branch` reaches a terminal state. Returns conclusion (success/failure/cancelled/...). Exponential backoff (default 5s → 30s cap, max wait 30min). Status `timeout` and `errored` (gh repeatedly failing) are valid outcomes. |
| `tpdc_fetch_ci_logs` | `gh run view --log-failed` for the most recent run on `branch`. Returns tail-preserved log blob (default 8KB cap). Used to feed FailureContext into a fix-mode `tpdc_execute`. |
| `tpdc_team_meeting` | **D6.** Convenes 2-4 role agents (PM, TechLead, Designer, Engineer) in parallel + Opus moderator synthesis. Returns synthesized answers with role provenance, assumptions to commit to, preserved dissent, consensus boolean, and optional escalateToHuman. ~$0.30 / 60-75s per meeting. Single-shot (no recursion). Use when intake/plan can't converge after 2-3 rounds, or for explicit multi-perspective deliberation. |

## Coming next (v0.4 chapter, after alpha.0 prompt caching)

| Item | Form | Notes |
|---|---|---|
| Memory tool | beta `memory_20250818` | `/memories` adapter for multi-session continuity. The platform's "multi-session software dev pattern" matches TPDC. |
| Observability tool | New MCP tool | `tpdc_show_run_summary` — per-stage cost + advisor fires + wall-clock. Depends on Memory for run-state persistence. |
| Compaction | beta `compact-2026-01-12` | `pause_after_compaction` for long execute loops. Add when 1M context is felt to be insufficient. |
| Web search / fetch | GA | Intake/plan research on user-mentioned libs / pasted URLs. |

## History

Legacy v1 skills (`develop`, `solve`, `discovery`, `assess`, `fix`, `refactor`, `show`, `diff`) were removed in v0.3.0-alpha.10. Their MCP tool references targeted the archived Inngest backbone and are no longer functional. Git history preserves them under the pre-alpha.10 tags if reference is needed.

## Architecture rules

- TPDC commands must be explicitly invoked via slash commands. Do NOT auto-route arbitrary user requests through TPDC.
- For mutation operations (execute, push, open-PR), TPDC MCP tools require explicit consent + a real repo path.
- Skills use Claude Code's native tools (Read, Grep, Glob, Bash) for exploration. MCP tools are for validation and heavy autonomous loops.
- Never apply patches silently — always show diffs and require confirmation.

## Setup

The plugin's `.mcp.json` launches `tpdc-mcp` (the stdio MCP server). The launcher script (`start-mcp.sh`) handles `npm install` if needed. No external server, no webhook, no tunnel — TPDC runs entirely inside Claude Code.

See `VISION.md` for the form-factor lock and capability matrix.
