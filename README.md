# TPDC Engine

> **v2 alpha** — autonomous development workflow engine that takes a feature request and ships a PR with CI green, without human intervention beyond optional clarification rounds.

⚠️ **Status:** v2 is in active development (`0.2.0-alpha.x`). The pipeline is functional end-to-end and validated against a real GitHub repo with real CI, but the API surface, schemas, and CLI may change. The legacy v1 implementation lives under `*-v1-archive/` directories and is no longer maintained.

---

## What it does

Given a request like *"Add a `parseInteger(input)` function that throws on invalid input and add tests"*, TPDC v2:

1. **Intakes** — converts the request into a structured ticket with binary acceptance criteria. Asks clarifying questions if the request is too vague.
2. **Plans** — breaks it into ordered, PR-shaped steps with dependencies, risk level, and concrete validation commands.
3. **Executes** — agentic loop with `bash` + `text_editor` tools scoped to a fresh git worktree, writes code respecting the plan.
4. **Validates** — runs `npm test` (or whatever the plan specified), auto-fixes test failures with up to 3 retries.
5. **Pushes** — `git push -u origin <branch>` with worktree cleanup.
6. **Opens a PR** — `gh pr create` with title from the intake and a body auto-rendered from intake + plan + diff + test results.
7. **Waits for CI** — workflow hibernates on `step.waitForEvent`, wakes when GitHub's check_suite completes.
8. **Auto-fixes CI failures** — if CI fails, fetches logs, dispatches a fix-mode execute, force-pushes, re-waits. Up to 3 retries.

Final outcome: a PR with CI green, ready for human review and merge.

---

## Architecture (one paragraph)

TPDC v2 is a TypeScript ESM project running on Node 22+. Workflows are durable: built on **Inngest** for state persistence, retries, and hibernation across hours/days. The agent loop uses **Claude Sonnet 4.6** via Anthropic's structured outputs (Zod-validated) plus an **Advisor pattern** option for complex decisions (Opus 4.6 escalation). Each pipeline stage is a focused module with its own schema, prompt, and tests. Three "resolver" helpers (`resolve-intake`, `resolve-plan`, `resolve-tests`, `resolve-ci`) implement evaluator-optimizer loops with explicit budget caps and no-progress guards. GitHub integration uses `gh` CLI (zero new deps; gh handles auth) plus a Hono webhook receiver for CI events.

For the full design rationale, see `~/Documents/Claude/Projects/TPDC/DECISIONS.md` (architectural decisions log) and `~/Documents/Claude/Projects/TPDC/research/` (the 7 research dossiers that informed v2).

---

## Quick start

### Requirements

- **Node 22+**
- **`gh` CLI** logged in (`gh auth login`) for the push/PR stages
- **`ANTHROPIC_API_KEY`** for the LLM calls
- **Inngest dev server** for local workflow execution
- **A public URL** (cloudflared or ngrok) for the GitHub webhook in dev

### Install

```bash
git clone https://github.com/Mtrejo11/tpdc-engine.git
cd tpdc-engine
npm install
npm run build
```

### Run locally

```bash
# Terminal 1 — TPDC server (Hono + Inngest endpoint + GitHub webhook)
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_WEBHOOK_SECRET=<random-secret>
npm run dev

# Terminal 2 — Inngest dev server (function discovery + UI at :8288)
npm run inngest:dev

# Terminal 3 — public tunnel for the webhook
cloudflared tunnel --url http://localhost:3000
```

### Configure the GitHub repo (target of the workflow)

In the target repo's `Settings → Webhooks`:
- **Payload URL**: `<TUNNEL_URL>/api/github/webhook`
- **Content type**: `application/json`
- **Secret**: same as `GITHUB_WEBHOOK_SECRET` above
- **Events**: only "Check suites"

The repo also needs a GitHub Actions workflow running tests (e.g., `node --test test/*.test.js`). Without it, no `check_suite` event fires and the wait-CI stage hibernates until timeout.

### Trigger a workflow

```bash
curl -X POST http://localhost:8288/e/test-key \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tpdc/feature.requested",
    "data": {
      "runId": "my-first-run",
      "request": "Add a function `multiply(a, b)` to src/index.js (ESM) that returns a*b. Add a test in test/multiply.test.js using node:test.",
      "repoRoot": "/path/to/your/repo"
    }
  }'
```

Watch the run progress at `http://localhost:8288`. If intake or plan asks clarifying questions, answer with `tpdc unblock`:

```bash
# Read the questions from the Inngest UI, write your answers as JSON
cat > answers.json <<EOF
[
  { "question": "Which platforms?", "answer": "Web only" }
]
EOF

node dist/cli/index.js unblock my-first-run --answers ./answers.json
```

For plan stage clarifications, the JSON shape is `[{ blocker, resolution }, ...]` and you pass `--stage plan`.

---

## CLI

```
tpdc version
tpdc unblock <runId> --answers <path-to-json> [--stage intake|plan]
```

---

## Pipeline (full surface)

```
                       USER REQUEST
                            │
                            ▼
              ┌─ intake (with unblock loop)
              │     │
              │     ▼ readiness=ready
              ├─ plan (with unblock loop)
              │     │
              │     ▼ readiness=ready, steps>0
              ├─ execute (worktree + agent loop + commit)
              │     │
              │     ▼ status=completed
              ├─ run-tests + auto-fix loop          ← stage 8 local
              │     │
              │     ▼ status=all_passed
              ├─ push (with worktree cleanup)
              │     │
              │     ▼ status=pushed
              ├─ open-PR (gh pr create)
              │     │
              │     ▼ status=opened
              ╰─ wait-CI + auto-fix CI loop         ← stage 8 remote
                    │
                    ▼ status=success
                  DONE: { stage: "ci-green" }
```

Each gate halts cleanly with a structured reason. Each loop has a budget cap (3 retries default) and no-progress guards. The auto-fix loops use the **evaluator-optimizer** pattern from Anthropic's "Building effective AI agents" — local tests covered by `resolve-tests.ts`, remote CI covered by `resolve-ci.ts`.

---

## Repository layout

```
src/
├── runtime/                    # Executor + Advisor primitives
├── stages/
│   ├── intake/                 # Stage 1: structured ticket from raw request
│   ├── plan/                   # Stage 2: ordered steps with testCommands
│   ├── execute/                # Stage 3: agentic worktree edits with bash + text_editor
│   ├── run-tests/              # Stage 4: validation via plan.testCommands
│   ├── push/                   # Stage 5: git push + worktree cleanup
│   └── open-pr/                # Stage 6: gh pr create with body template
├── inngest/
│   ├── client.ts               # Inngest typed event client
│   └── workflows/
│       ├── lib/                # resolve-intake, resolve-plan, resolve-tests, resolve-ci
│       └── ship-feature.ts     # Main pipeline workflow
├── server/
│   └── github-webhook.ts       # check_suite parser + HMAC verify
├── server.ts                   # Hono server (Inngest + GitHub webhook routes)
├── schemas/events.ts           # Zod schemas for all Inngest events
├── cli/                        # tpdc CLI (version, unblock)
└── mcp/                        # MCP server stub (future v2.x)

dist/                           # Build output (regenerated by tsc; not committed)
*-v1-archive/                   # Legacy v1 implementation (read-only reference)
```

---

## Tests

```bash
npm test            # 140 unit tests + 2 integration (skipped without ANTHROPIC_API_KEY)
npm run test:watch  # vitest in watch mode
npm run test:coverage
```

Integration tests that hit the real Anthropic API are gated by `ANTHROPIC_API_KEY` env var and cost a few cents per run. Worktree integration tests use real git in `mkdtemp` directories.

---

## What's NOT in v2 alpha

This is `0.2.0-alpha`, not a feature-complete release. Known gaps:

- **Webhook setup is manual** — no automated provisioning. Each smoke session needs a fresh ngrok/cloudflared tunnel.
- **No telemetry / observability** — `console.log` from Inngest is the audit trail.
- **No multi-repo orchestration** — one workflow run targets one repo via `repoRoot`.
- **No agent skill marketplace** — stages are fixed code; you can't drop a `.skill.md` to extend the pipeline.
- **MCP server is a stub** — there's a placeholder for shipping TPDC as a Claude Code plugin via stdio MCP, but it's not implemented in alpha.
- **One-on-one stage tools** — `bash` + `text_editor` only. No browser automation, no remote services, no `web_fetch` tool wired into execute.
- **Single-attempt fix loops not validated end-to-end** — local auto-fix loop is unit-tested but not exercised in production yet (the agent has been getting first-try right in smokes).

The `HANDOFF.md` doc in this directory's parent `Documents/Claude/Projects/TPDC/` directory tracks the latest tech debt and roadmap.

---

## Origins

TPDC v2 is a clean rewrite that started from a 7-frente research dossier evaluating cutting-edge architectures from Anthropic, Cognition (Devin), Cursor, Sourcegraph, and others. The full design log lives in `~/Documents/Claude/Projects/TPDC/DECISIONS.md` (5 architectural decisions, ADR-style). The v1 implementation that preceded it lives under `*-v1-archive/` for reference.

---

## License

MIT
