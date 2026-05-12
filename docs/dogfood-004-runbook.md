# Dogfood-004 — Validation Runbook (v0.3 plugin/MCP form)

*Target version: `v0.3.0-alpha.10` (post-alpha-10 cleanup).*
*Goal: validate the v3 pivot end-to-end against the same task that broke dogfood-002 in the Inngest era — "Mejorar la UI de los action buttons de la card" on `Mtrejo11/inventario-reventa`.*

This is the **first** validation smoke for the v0.3 architecture. The form-factor lock (VISION.md §2 inmutable #1) reshaped how this runs versus the unfinished `dogfood-003-runbook.md`. Reading the two side-by-side captures the pivot:

| Aspect | dogfood-003 (Inngest era) | dogfood-004 (v0.3 plugin) |
|---|---|---|
| Setup | 3 terminals (TPDC server, Inngest dev, cloudflared) + GitHub webhook | 1: install plugin in Claude Code |
| Entry | `curl -X POST http://localhost:8288/e/test-key` | `/tpdc:ship "..."` in Claude Code chat |
| Unblock | `tpdc unblock <runId> --answers json` | Reply to Claude Code in chat |
| CI wait | Webhook receiver + Inngest hibernation | `tpdc_wait_ci` polls `gh run list` |
| Observability | Inngest UI at `:8288/runs` | Claude Code's chat + MCP tool result JSON |

---

## 1. Pre-flight checklist

- [ ] Engine repo on `main` at tag `v0.3.0-alpha.10`. `npm install` clean, `npm run build` fresh.
- [ ] `npm test` passes (215 passing, 3 skipped — integration tests gated by API key).
- [ ] `ANTHROPIC_API_KEY` exported (used by the MCP server's outbound calls to Claude — Sonnet 4.6 + Opus 4.7 for advisor).
- [ ] `gh auth status` shows logged in with **push access** to `Mtrejo11/inventario-reventa`.
- [ ] `Mtrejo11/inventario-reventa` cloned locally and on its default branch.
- [ ] No stale `.tpdc/worktrees/` directories under the target repo. Clean them with `git worktree prune` if any exist.
- [ ] Claude Code installed and running, with the user's preferred model (Sonnet 4.6+).
- [ ] **NO** Inngest dev server running. **NO** cloudflared tunnel. **NO** webhook configured. If you see yourself starting any of those, you've drifted — re-read VISION.md.

---

## 2. Install the plugin (one-time)

The plugin is in `tpdc-engine/tpdc-plugin/`. Install it into Claude Code's local marketplace:

```bash
cd ~/Documents/Personal/tpdc-engine

# Use Claude Code's plugin install flow.
# Either: link a local marketplace, or copy the plugin dir to Claude Code's plugins location.
# Exact command depends on Claude Code's version — see its docs.
# Typical pattern (subject to change):
#   /plugin marketplace add /path/to/tpdc-engine/tpdc-plugin/.claude-plugin/marketplace.json
#   /plugin install tpdc
```

Verify the install:

1. In Claude Code chat, list available skills. You should see `intake`, `plan`, `ship`, `auto-fix-ci`.
2. Call the MCP ping tool to confirm the server starts:
   - In chat: "use the `tpdc_ping` MCP tool with message=hello"
   - Expected response: `tpdc-mcp v0.3.0-alpha.10 alive echo: hello`

If `tpdc_ping` fails, check the launcher script (`tpdc-plugin/start-mcp.sh`) — it should run `node dist/mcp/server.js` from the engine repo. The repo's `dist/` must be built (`npm run build`).

---

## 3. Trigger the smoke

The target task is **identical to dogfood-002** (Inngest era) so the comparison is apples-to-apples:

In Claude Code, with `Mtrejo11/inventario-reventa` as the working directory:

```
/tpdc:ship "Mejorar la UI de los action buttons de la card"
```

(Or in natural language: "Run TPDC ship on this repo for: Mejorar la UI de los action buttons de la card")

Claude Code will:

1. Read `tpdc-plugin/skills/ship/SKILL.md` and follow it.
2. Generate a `runId` (e.g., `ship-20260512-103045-a1b2c3`).
3. Print a one-liner summary of the run setup.

---

## 4. Expected progression

### Stage 1 — Intake (delegated to intake skill)

Claude Code reads `tpdc-plugin/skills/intake/SKILL.md` and:

1. Uses **its own Read/Grep/Glob** (NOT the MCP server) to explore the repo:
   - `Read package.json` → detects React + Vite + Tailwind
   - `Glob src/components/*Card*.tsx` → finds `ProductCard.tsx`
   - `Read src/components/ProductCard.tsx` → understands current button rendering
   - `Bash git log --oneline -10` → recent context

2. **Should NOT** ask the user about:
   - Which framework
   - Which component (ProductCard found by grep)
   - What stack
   - What test runner

3. **May ask the user** about (these are irreducibly human):
   - Which action is primary (Edit vs Mark as sold vs another)
   - How aggressive: minimal patch vs polished redesign
   - Color preferences (if no design system documented)

4. Builds a candidate `IntakeArtifact` and calls `tpdc_validate_intake_artifact`. Iterates on errors if needed.

**Success criterion for stage 1:** Claude Code asks 1-2 product questions max, NOT 4 like the v2 era. The repo-derivable questions are auto-resolved.

### Stage 2 — Plan (delegated to plan skill)

Claude Code reads `tpdc-plugin/skills/plan/SKILL.md`, re-anchors with another Read of `ProductCard.tsx`, produces a candidate `PlanArtifact`, calls `tpdc_validate_plan_artifact`.

**Success criterion for stage 2:** Plan has 2-3 concrete steps (not "implement everything" mega-step, not 8 micro-steps). RiskLevel = `medium` (honest — modifies existing UI). `testCommands` reference a real test command from the repo's package.json.

### Gate 1 — Review plan

Claude Code presents the plan summary and asks: "Run as planned, tweak first, or stop?"

**Action:** Pick "Run as planned."

### Stage 3 — Execute (`tpdc_execute`)

Claude Code calls the MCP tool. The MCP server creates a worktree under `<repoRoot>/.tpdc/worktrees/<runId>/`, runs the agentic loop (bash + text_editor + **advisor**), captures diff, commits.

**What to watch:**

- The worktree directory appears at `<repoRoot>/.tpdc/worktrees/ship-<timestamp>/`.
- The MCP server's stderr (if you have it visible somewhere) should show Sonnet 4.6 calls.
- **Advisor tool firing:** if the run is non-trivial, Sonnet should consult the advisor 1-2 times. Look for `server_tool_use` blocks with `name: "advisor"` in the response JSON. If you can see token counts, advisor calls show up in `usage.iterations[]`.

**Success criterion for stage 3:** Status `completed` (NOT `max_turns_exceeded`, NOT `tool_error_loop`, NOT `no_changes`). Files changed include `src/components/ProductCard.tsx`. Diff is coherent.

### Stage 4 — Run tests (`tpdc_run_tests`)

Run the plan's `testCommands` in the worktree.

**Success criterion for stage 4:** `all_passed`. If `some_failed`, the inline local-fix loop in the ship skill should kick in (re-execute with `failureContext`). If still failing after retries, ship halts.

### Stage 5 — Push (`tpdc_push`)

`git push -u origin <branch>` from the worktree. On success, the worktree directory is removed (the branch ref stays).

**Success criterion for stage 5:** Status `pushed`. `<repoRoot>/.tpdc/worktrees/<runId>/` no longer exists. Branch `tpdc/run-<runId>` exists on the remote.

### Stage 6 — Open PR (`tpdc_open_pr`)

`gh pr create` with body rendered from intake + plan + execute + tests.

**Success criterion for stage 6:** Status `opened`. PR URL returned. PR body includes structured sections (Problem, Plan, Changes, Validation).

### Gate 2 — Auto-fix CI?

Claude Code presents: "PR opened: `<url>`. What's next?"

**Action:** Pick "Wait for CI + auto-fix any failures."

### Stage 7 — Auto-fix-CI (delegated to auto-fix-ci skill)

Claude Code reads `tpdc-plugin/skills/auto-fix-ci/SKILL.md`. Calls `tpdc_wait_ci` to poll `gh run list`. If CI fails:
- `tpdc_fetch_ci_logs`
- Confirms with user (gate inside the skill)
- `tpdc_execute` in fix-mode
- Confirms force-push with user (gate inside the skill)
- `tpdc_push` with `force: true`
- Loop until CI green or maxRetries (default 3)

**Success criterion for stage 7:** Either CI green on first try (best case) or auto-fix succeeds within 1-2 retries. CI green is the goal.

### Done

Claude Code presents the final summary:
- PR URL + number
- CI conclusion: success
- Local fix retries: N / 3
- CI fix retries: N / 3

---

## 5. Success criteria (formal checklist)

Map your run. Mark with ✅ / ❌ / ⚠️.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Intake asks <= 2 product/human questions, no repo-derivable ones | | Chat transcript |
| 2 | Plan validates on first or second attempt (no DAG errors) | | Validator result |
| 3 | Plan has concrete steps with real `testCommands` | | Plan JSON |
| 4 | Execute reaches `status: completed` | | ExecuteResult JSON |
| 5 | Execute fires the advisor tool at least once | | server_tool_use blocks / iterations usage |
| 6 | Run-tests `all_passed` (with at most 1 local-fix retry) | | RunTestsResult |
| 7 | Push succeeds, worktree cleaned up | | PushResult, filesystem check |
| 8 | PR opened with structured body | | PR URL, view body |
| 9 | Wait-CI returns completed within 30min | | WaitCIResult, GitHub UI |
| 10 | Final CI conclusion = success (with up to 3 fix retries) | | Final summary |
| 11 | Total cost < $5 (intake + plan + execute + advisor + run-tests + maybe team-meeting) | | Sum from MCP tool responses |
| 12 | Total wall-clock < 30min interactive (excluding long CI waits) | | Stopwatch |

### Anti-checklist — these should ALWAYS be ✅ "Yes, not seen"

| # | Anti-criterion | Status |
|---|---|---|
| A1 | NO Inngest dev server was started | |
| A2 | NO cloudflared/ngrok tunnel was used | |
| A3 | NO GitHub webhook was configured | |
| A4 | NO `tpdc-engine/dist/server.js` was invoked | |
| A5 | NO `curl` POST to `/e/test-key` was needed | |

If any of A1-A5 are ❌ "yes, was seen", we drifted from VISION.md somewhere.

---

## 6. Comparison vs dogfood-002 (the failure)

`dogfood-002` (alpha.1 + alpha.2, Inngest era):
- Intake halted at `attempt=3` with the same blocking question fractalizing.
- Never reached execute.
- $0.05 cost, value = 0.
- Asked the user 4 product questions (which framework, which card, what platform, design spec) — most of which the intake should have auto-resolved.

For `dogfood-004` to count as a win **vs dogfood-002**:
- Intake auto-resolves the repo-derivable questions (criterion #1 above). This validates the form-factor pivot's central thesis.
- Pipeline reaches execute (any outcome from execute is informative; dogfood-002 never got there).

---

## 7. What to capture (for the post-smoke HANDOFF update)

Paste this template into HANDOFF.md with values filled in:

```markdown
## dogfood-004 result — <date>

**Outcome:** [ ✅ success | ⚠️ partial | ❌ blocked ]

**Stages reached:** [ intake | plan | execute | run-tests | push | open-pr | wait-ci | auto-fix-ci | done ]

**Where it stopped (if not done):** <stage + reason>

**Form-factor adherence:** [ ✅ no Inngest/tunnel/webhook drift seen | ❌ drifted at <step> ]

**Intake quality:**
- Repo-derivable questions auto-resolved: [ yes | partial | no ]
- Human questions asked: <N>
- Examples of human questions: <quotes>

**Advisor tool usage:**
- Times fired: <N>
- Decision types: <list>

**Cost breakdown:**
- Intake: $<X>
- Plan: $<X>
- Execute: $<X> (including advisor)
- Run-tests: $0 (no LLM)
- Auto-fix-CI (if fired): $<X>
- Team meeting (if fired): $<X>
- **Total: $<X>**

**Wall-clock:**
- Interactive (intake → PR open): <Nmin>
- CI wait: <Nmin>
- Total: <Nmin>

**PR opened:** <URL>
**Final CI conclusion:** <success | failure | timeout | cancelled>
**Retries:** local <N>/3, CI <N>/3

**Surprises (good or bad):** <list>

**Decision:** [ tag v0.3.0 | ship alpha.11 with fix for <thing> | rethink <subsection of VISION> ]
```

---

## 8. Post-smoke decisions

### If §5 has all ✅:
Tag `v0.3.0`:

```bash
git tag v0.3.0
git push origin v0.3.0
```

Update HANDOFF with the result + close the v0.3 chapter. Add a memory entry capturing the cost/time numbers. Open the v0.4 roadmap with the remaining VISION.md §4 platform capabilities (Memory tool, Compaction, Web search/fetch, Prompt caching).

### If §5 has ⚠️ partial (some ✅, some ❌ on D6-style criteria):

Diagnose and ship `alpha.11` with the targeted fix. Don't release. Re-smoke after.

### If §5 has ❌ on the anti-checklist (A1-A5 triggered):

That's a hard drift. Re-read VISION.md and audit how the drift happened — likely a buggy skill instruction or a corner case in the plugin install. Architectural reconsideration.

### If most criteria pass but criterion #5 (advisor firing) is ❌:

Not a release blocker — the advisor was the goal of alpha.8 but its actual usage depends on Sonnet deciding to call it. If it never fired, the prompt addendum in `execute.prompt.ts` may need stronger guidance. File as alpha.11 prompt-tuning, not a hard halt.

---

## 9. After v0.3.0 — what's next

Once v0.3.0 ships, the VISION.md §4 capability adoption list is the natural next chapter:

- **Memory tool** (HIGH) — multi-session continuity (`/memories` adapter)
- **Compaction** (HIGH) — `pause_after_compaction` for very long execute runs
- **Prompt caching** (HIGH) — wireup on system prompts, ~30-50% cost reduction in long loops
- **Web search / Web fetch** (MEDIUM) — for intake / plan research

Each is a focused alpha (or beta for the trickier ones). Same pattern as advisor — `client.beta.messages.create` + cast as BetaToolUnion + beta flag.

---

*This runbook is single-use. If alpha.11 ships and we re-smoke, write `dogfood-005-runbook.md` (and keep this one). The runbook diff captures the lesson.*
