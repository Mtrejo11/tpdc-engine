# TPDC v0.3.0 — Release notes

*Released after dogfood-004 smoke validated end-to-end against `Mtrejo11/inventario-reventa`.*

## What this release is

TPDC v0.3.0 is a **form-factor pivot**: the engine ships as a Claude Code plugin + MCP server, no longer as a backend service. The user types a feature request in Claude Code (`/tpdc:ship "Mejorar la UI..."`), the workflow walks through 8 pipeline stages, and the result is a PR with CI green — all without leaving the Claude Code chat.

This replaces the v0.2 architecture (Inngest workflow engine + Hono server + GitHub webhook receiver + cloudflared tunnel) which was archived under `src-v2-inngest-archive/`.

The pivot was driven by `~/Documents/Claude/Projects/TPDC/VISION.md` and its 5 inmutables:

1. Form factor: plugin/MCP de Claude Code (NOT server, NOT SaaS, NOT daemon).
2. Apoyarse en el platform de Anthropic siempre que aplique.
3. Stages como skills (with `allowed-tools`).
4. Claude Code orquesta — TPDC expone primitivas, no reimplementa orquestación.
5. Cierre del ciclo end-to-end (request → PR con CI verde).

## Surface

**4 skills** (slash-commandable in Claude Code):

- `/tpdc:ship` — top-level end-to-end pipeline (the entry point)
- `/tpdc:intake` — structure a vague request into a typed IntakeArtifact
- `/tpdc:plan` — decompose intake into ordered steps with DAG dependencies
- `/tpdc:auto-fix-ci` — wait for CI, fix on failure (composition of MCP tools)

**10 MCP tools** (called by skills, also directly):

- `tpdc_ping` — health check
- `tpdc_validate_intake_artifact` — Zod validation
- `tpdc_validate_plan_artifact` — Zod + DAG semantic invariants
- `tpdc_execute` — agentic bash + text_editor + **advisor** loop in a worktree
- `tpdc_run_tests` — execute `plan.testCommands` with per-command capture
- `tpdc_push` — `git push -u` + worktree cleanup
- `tpdc_open_pr` — `gh pr create` with structured body
- `tpdc_wait_ci` — poll `gh run list` with exponential backoff
- `tpdc_fetch_ci_logs` — `gh run view --log-failed` for fix-mode context
- `tpdc_team_meeting` — D6 multi-perspective deliberation (PM/TechLead/Designer/Engineer + Opus moderator)

## Platform adoptions

This release adopts the first new platform capability beyond the basics:

- **Advisor tool** (beta `advisor-tool-2026-03-01`) wired into the execute stage. Sonnet 4.6 consults Opus 4.7 as a server-side sub-inference mid-loop on hard sub-decisions, with built-in cap of 5/run. Replaces the manual two-call escalation pattern.

Foundation for future capability adoptions:

- Execute uses `client.beta.messages.create` exclusively, so additional beta-flagged tools (Memory tool, Compaction, Web search/fetch, Prompt caching) can be wired in with the same pattern in v0.4+.

## Pipeline stages

```
                       USER REQUEST (chat)
                            │
                            ▼
              ┌─ /tpdc:intake (skill — uses Read/Grep/Glob natively)
              │     │
              │     ▼ readiness=ready
              ├─ /tpdc:plan (skill — DAG validated)
              │     │
              │     ▼ readiness=ready, steps>0
              ├─ tpdc_execute (MCP — worktree + bash + text_editor + advisor)
              │     │
              │     ▼ status=completed
              ├─ tpdc_run_tests (MCP — with inline local-fix loop via execute fix-mode)
              │     │
              │     ▼ status=all_passed
              ├─ tpdc_push (MCP — with worktree cleanup)
              │     │
              │     ▼ status=pushed
              ├─ tpdc_open_pr (MCP — gh pr create)
              │     │
              │     ▼ status=opened
              ╰─ /tpdc:auto-fix-ci (skill: wait → fetch-logs → execute fix-mode → push --force)
                    │
                    ▼ ciConclusion=success
                  DONE: { status: "success", prUrl, ciConclusion }
```

## Validation

`dogfood-004` smoke against `Mtrejo11/inventario-reventa` with the request "Mejorar la UI de los action buttons de la card" — the same task that broke `dogfood-002` in the v0.2 era.

Result: **success on first attempt.**

- PR: https://github.com/Mtrejo11/inventario-reventa/pull/1
- CI: both test workflow runs SUCCESS on HEAD 2cd5204
- Local fix retries: 0/3
- CI fix retries: 0/3
- Files changed: src/components/ProductCard.jsx, src/styles.css (+112 / -15)

What shipped:

- Vender / Revertir as the visible primary action (filled, ≥44px tall, WCAG AA)
- Editar / 📦 ZIP / 🗑 Eliminar moved into a ⋯ overflow menu (right-anchored, opens upward, click-outside + Escape to close)
- Destructive Eliminar requires deliberate two-tap
- Floating Promo FAB left untouched as agreed

The agent recognized scope (intentionally did NOT commit unrelated `bun.lock` / `package.json testing-library` additions in the working tree). This kind of scope discipline is what `dogfood-002` couldn't reach — the v3 form's auto-repo-context + advisor + clear skill workflow produced both the convergence and the discipline.

## Anti-drift validation

The 5 inmutables held: no Inngest dev server, no cloudflared tunnel, no GitHub webhook receiver, no separate Hono process. The run was 100% inside Claude Code + MCP stdio.

## Tests

`npm test`: **215 passing**, 3 gated integration tests (skipped without `ANTHROPIC_API_KEY`).

## Migration from v0.2

If you had v0.2 installed:

- Uninstall the old Hono server / Inngest setup.
- The legacy v1 plugin skills (`develop`, `solve`, `discovery`, `assess`, `fix`, `refactor`, `show`, `diff`) were removed in alpha.10. They referenced archived MCP tools.
- Install the v3 plugin from the local marketplace (see README).

## What's next (v0.4 backlog)

Per VISION.md §4, the remaining HIGH-priority platform capabilities to adopt:

- **Memory tool** — multi-session continuity via `/memories` adapter.
- **Compaction** — `pause_after_compaction` for very long execute loops.
- **Prompt caching** — wireup on system prompts, ~30-50% cost reduction in long loops.

MEDIUM-priority for v0.4:

- **Web search / Web fetch** — for intake / plan research on user-mentioned libs and pasted URLs.

Observability gap to close:

- Per-stage cost + advisor fire count + wall-clock breakdown surfaced to the user (currently only the final `executeResult` JSON has token usage; per-stage totals aren't aggregated).

## Acknowledgments

The v0.3 pivot was a course-correction after the original architecture drifted into "small SaaS backend" territory despite the original vision being "plugin sin pedo". `VISION.md` was written to lock the form factor explicitly so future decisions can be checked against the 5 inmutables.

The dogfood-004 task ("Mejorar la UI de los action buttons de la card" on `Mtrejo11/inventario-reventa`) was chosen as the validation target because it had previously broken the v0.2 intake recursion. The successful v0.3 run on the same task closes that loop.
