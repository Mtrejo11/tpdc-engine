# TPDC — Technical Product Development Cycle

> **Status:** v0.3.0-alpha.3 (pivot in progress to Claude Code plugin + MCP server). The source of truth for architecture is `~/Documents/Claude/Projects/TPDC/VISION.md` in the source repo.

TPDC is an autonomous development workflow that takes a feature request in natural language and produces a PR with CI green. It ships as a **Claude Code plugin** plus an **MCP server** (`tpdc-mcp`). Claude Code orchestrates; TPDC exposes validators + heavy operations as MCP tools and ships skills that instruct Claude Code on how to drive each stage.

## How it works (v0.3)

The pipeline has 8 stages: intake → plan → execute → run-tests → push → open-PR → wait-CI → auto-fix-CI.

Each stage is either:

- A **skill** (markdown in `skills/<stage>/SKILL.md`) — instructs Claude Code on how to do the stage using its native Read/Grep/Glob/Bash tools, with a small TPDC MCP validator at the end to check shape. Used for stages where the agent benefits from full repo context and conversational interaction (intake, plan).
- An **MCP tool** — used for stages that need agentic-and-autonomous loops (execute, run-tests, auto-fix-CI) or parallel coordination (team-meeting). Claude Code calls them and waits.

## Available now (v0.3.0-alpha.3)

| Skill | What it does | Status |
|---|---|---|
| `/tpdc:intake` (via `intake/SKILL.md`) | Convert vague feature request → typed IntakeArtifact. Auto-resolves repo-derivable questions via Read/Grep/Glob. | ✅ available |
| `/tpdc:plan` (via `plan/SKILL.md`) | Convert validated IntakeArtifact → typed PlanArtifact with ordered steps (DAG), riskLevel, testCommands. | ✅ available |

| MCP tool | What it does |
|---|---|
| `tpdc_ping` | Health check for the MCP server (plugin setup validation). |
| `tpdc_validate_intake_artifact` | Validate a candidate IntakeArtifact against the Zod schema. Returns `{ok, artifact}` or `{ok: false, errors: [{path, message, code}]}`. |
| `tpdc_validate_plan_artifact` | Validate a candidate PlanArtifact against the Zod schema AND semantic invariants (DAG, dependency refs, readiness/steps consistency). Same response shape. |
| `tpdc_execute` | Heavy autonomous tool: creates a git worktree under `<repoRoot>/.tpdc/worktrees/<runId>/`, runs the agentic bash + text_editor loop against the validated plan, captures the diff, commits. Returns the full ExecuteResult JSON (status, worktreePath, branch, baseSha, commitSha, filesChanged, diff, finalSummary, usage). Accepts optional `existingWorktree` + `failureContext` for fix-mode retries. |

## Coming next (alpha.4+)

| Stage | Form | Notes |
|---|---|---|
| Run-tests + auto-fix | MCP tool | Evaluator-optimizer over `plan.testCommands`. |
| Push | MCP tool | `git push -u origin <branch>` + worktree cleanup. |
| Open-PR | MCP tool | `gh pr create` with body rendered from intake + plan + diff. |
| Wait-CI | MCP tool | Polls `gh run watch` until CI green / failed. |
| Auto-fix-CI | MCP tool | Fetch logs + fix-mode execute + force-push + re-wait. |
| Team-of-agents meeting (D6) | MCP tool | Parallel PM/TechLead/Designer/Engineer + Opus moderator when intake doesn't converge. |
| Advisor tool integration | Refactor of execute | Replace manual Opus escalation with the platform's beta advisor tool (VISION.md §4). |
| Top-level "ship a feature" | Skill | Chains intake → plan → execute → ... with Claude Code orchestrating. |

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
