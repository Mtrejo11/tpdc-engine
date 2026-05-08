# TPDC v0.2.0-alpha.1

**The first alpha of TPDC v2** — an autonomous development workflow engine that takes a feature request and ships a PR with CI green, without human intervention beyond optional clarification rounds.

---

## What this release is

TPDC v2 is a clean rewrite of the v1 engine (which lived under `*-v1-archive/` directories now). The pipeline is functional end-to-end and was validated against a real GitHub repo (`Mtrejo11/tpdc-smoke`) with real CI on May 8, 2026. From a one-paragraph feature request, the system ran 8 stages — intake, plan, execute, run-tests, push, open-PR, wait-CI, auto-fix-CI — and ended with a PR open and CI green, no human in the loop except for an optional unblock round during intake.

This is `0.2.0-alpha.1` because the API surface, schemas, and CLI may change as we learn from real-world use. The architecture is settled (see `DECISIONS.md` in the workspace folder of the project root); what's settling now is the operational story.

---

## What's in the box

**Pipeline (8 stages):**

```
intake (with unblock loop)
  → plan (with unblock loop)
    → execute (worktree + agent loop + commit + fix-mode)
      → run-tests (with auto-fix loop)
        → push (with worktree cleanup)
          → open-PR (with body markdown auto-rendered)
            → wait-CI (hibernation real)
              → auto-fix-CI loop
                → DONE (status: completed, stage: ci-green)
```

**Each stage is its own module** with schema + prompt + implementation + unit tests. Loops use the **evaluator-optimizer** pattern with budget caps (3 retries default) and no-progress guards.

**Stack:**
- Node 22+, TypeScript ESM (NodeNext)
- **Inngest** for durable workflow execution + hibernation
- **Hono** for the HTTP server (Inngest endpoint + GitHub webhook receiver)
- **Anthropic Claude Sonnet 4.6** as the executor; **Opus 4.6** wired as Advisor (escalation pattern)
- **Structured outputs** via `@anthropic-ai/sdk/helpers/zod` — schema-enforced JSON
- **gh CLI** for GitHub operations (zero new deps; auth handled by gh)

**Tests:** 140 unit tests + 2 integration tests gated by `ANTHROPIC_API_KEY`.

---

## Quick start

See `README.md` for the full setup. In short:

```bash
git clone https://github.com/Mtrejo11/tpdc-engine.git
cd tpdc-engine
npm install
npm run build

# Required env
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_WEBHOOK_SECRET=<random>

# Three terminals:
npm run dev                          # Hono server with /api/inngest + /api/github/webhook
npm run inngest:dev                  # Inngest dev server (UI at :8288)
cloudflared tunnel --url http://localhost:3000  # Public URL for GitHub webhook
```

Configure the target repo's webhook (Settings → Webhooks) with the tunnel URL + secret + "Check suites" event. Add a GitHub Actions workflow running tests so `check_suite` events fire.

Trigger via curl POST to the Inngest event endpoint — example in the README.

---

## What's NOT in this alpha

Honest list of gaps for anyone considering production use:

- **Webhook setup is manual.** No automated provisioning. Each session needs a fresh tunnel; ngrok/cloudflared URLs change.
- **No telemetry.** `console.log` from Inngest is the audit trail. No metrics, no dashboards beyond Inngest's own UI.
- **No multi-repo orchestration.** One workflow run targets one repo via `repoRoot`.
- **No agent skill marketplace.** Stages are fixed code. You can't drop a `.skill.md` to extend the pipeline.
- **MCP server is a stub.** Claude Code plugin distribution is planned for v2.x.
- **One-on-one stage tools.** `bash` + `text_editor` only inside the agent loop. No browser, no `web_fetch` wired.
- **Auto-fix loops not stress-tested in production.** Both local-tests and remote-CI loops are fully unit-tested but the "agent fixes its own failure" path has hit unit-test coverage only — the agent has been getting first-try right in smokes.
- **Step types in resolvers are `any`.** Inngest's step type is heavily generic; tightening this is queued for v2.x.

The HANDOFF doc tracks the full TODO list with [old]/[CLOSED]/NEW status.

---

## How to report issues

Open an issue at https://github.com/Mtrejo11/tpdc-engine/issues with:
- The runId from the failing workflow
- Inngest UI screenshot or relevant step logs
- The request you submitted
- Expected vs actual behavior

For tasks that need debugging help, the worktree under `<repoRoot>/.tpdc/worktrees/<runId>/` is preserved on failure for inspection.

---

## What's coming next

Post-alpha priorities, in rough order:

1. **Dogfooding against real personal projects** — find bugs that smokes don't surface.
2. **MCP server real** (closing the stub) — distribute as a Claude Code plugin.
3. **Eval suite** specific to autonomous dev — cycle time, retry success rate, human-edit-rate post-PR.
4. **Generalize the four resolvers** to a single helper with pluggable validator (#16).
5. **Plan for v2.1**: web dashboard, multi-repo, telemetry.

---

## Origins

TPDC v2 is the result of 18+ design + build sessions starting from a 7-frente research dossier evaluating cutting-edge architectures from Anthropic, Cognition (Devin), Cursor, Sourcegraph, GitHub Copilot, Aider, OpenHands, Plandex, and Replit Agent. The full design rationale lives in `~/Documents/Claude/Projects/TPDC/DECISIONS.md` (5 architectural decisions, ADR-style) and the research dossiers under `~/Documents/Claude/Projects/TPDC/research/`.

The v1 implementation that preceded v2 is preserved under `*-v1-archive/` directories for reference.

---

## License

MIT
