# Dogfood-007 — Validation Runbook (v0.5 capabilities)

*Target version: `v0.4.0-alpha.9` (post web_search/web_fetch + compaction + MCP recorder).*
*Goal: validate the three v0.5 capability adoptions in a real run before tagging v0.5.0.*

This runbook is short — the plugin/MCP setup is identical to dogfood-004 and -006. The only new things to check are the v0.5 outputs.

---

## 1. What's new since dogfood-006

| Capability | Where it shows up | Pass criterion |
|---|---|---|
| `web_search` / `web_fetch` (alpha.7) | `executeResult.usage.webSearch.invocations`, `usage.webFetch.invocations` | Present if the agent reached for the web; absent otherwise. Both shapes valid. |
| Compaction (alpha.8) | `executeResult.usage.compaction.events` | Absent on a normal-sized task (< 120k input tokens). Presence on a heavy task is the success signal. |
| MCP recorder (alpha.9) | `<repoRoot>/.tpdc/memory/runs/<runId>.md` with structured sections | File exists with `## Execute`, `## Tests`, `## PR`, `## CI` sections (and a `# TPDC run <runId>` header). Sections appended via `tpdc_record_run_event`. |

Two important contract changes vs. previous dogfoods:

1. **The run-summary file is written by the ship skill, not the executor agent.** This is the alpha.9 design intent — we no longer rely on the executor following a prompt mandate. If the file is missing post-run, that's a ship-skill bug (verify `tpdc_record_run_event` calls happened), not an executor bug.
2. **The agent now has six tools, not four** (bash + text_editor + memory + web_search + web_fetch + advisor). If you see the agent reach for web tools mid-run, that's the new path exercising.

---

## 2. Pre-flight (quick)

- [ ] Engine repo at tag `v0.4.0-alpha.9`. `npm install && npm run build` done in the engine repo so `dist/` matches.
- [ ] Plugin re-installed in Claude Code (or restart the session). Verify by running `tpdc_ping` — version line should read `v0.4.0-alpha.9`.
- [ ] `gh auth status` ✓ and push access to the target repo.
- [ ] Choose a target task (see §3).
- [ ] If `<repoRoot>/.tpdc/memory/` has content from a previous run, **leave it as-is** — observing the recorder appending to an existing file (rather than always creating fresh) is part of the test.

---

## 3. Pick a task

The key signal we want from this dogfood is **web tool usage**. To get it, pick a task that naturally requires looking something up online — a library API, a recent changelog, a public spec.

### Option A (RECOMMENDED): `Mtrejo11/inventario-reventa` — CSV / XLSX export

> "Add a 'Export inventory to Excel' button to the product list that downloads an .xlsx with columns: name, quantity, price, stock_status. Use the SheetJS xlsx package."

Why this works:
- SheetJS isn't already in `package.json` → the agent has to look up the install + minimal usage. `web_search` + `web_fetch` should naturally fire (1-3 invocations).
- Concrete deliverable (button + util module + new dep) — easy to inspect.
- 2-4 file change → execute loop probably 10-25 turns. Won't trigger compaction, which is fine.
- Tests exist in the repo (already validated in dogfood-004) — gives us a `tests_complete` event to record.

### Option B: `Mtrejo11/inventario-reventa` — accessibility audit fix

> "Add `aria-label` and visible focus styles to all action buttons. Reference the latest WCAG 2.1 quick reference."

Web tools fire when the agent fetches the WCAG reference page. Smaller scope than A.

### Option C: Different repo

Skip unless you want a generality data point. The capabilities are repo-agnostic; we're testing the wiring, not the target.

**Pick A** unless you specifically want a smaller smoke.

---

## 4. Run the smoke

In Claude Code, with the target repo as the working directory:

```
/tpdc:ship "<your chosen task>"
```

Follow the workflow — confirm at each gate as usual.

---

## 5. Capture v0.5-specific observations

### 5a. Web tools

After execute completes, look at `executeResult.usage` — specifically:

```json
"webSearch": { "invocations": <N> },
"webFetch":  { "invocations": <N> }
```

Expected behavior on Option A: at least one of the two has `invocations >= 1`. If both are absent, the agent didn't reach for the web — note as a finding. Most likely cause: the agent inferred enough from the existing imports/repo conventions to skip lookup. Not necessarily a bug; could mean the task didn't require web after all.

If `invocations` is way higher than expected (say, > 5 combined): the prompt soft-cap isn't sticking. The `max_uses` caps (3 search, 5 fetch) are the hard backstop, so the run won't blow up — but worth noting that the agent over-browsed.

### 5b. Compaction

Same `executeResult.usage` block:

```json
"compaction": { "events": <N> }
```

Expected: **absent** on a normal-sized task. The trigger fires at 120k input tokens — small features don't reach that. If you see `events: 1+`, capture the turn count and total `inputTokens` from the same usage block — that's our first real data on when compaction kicks in.

### 5c. The MCP-recorded run summary

This is the headline alpha.9 deliverable. After the run:

```bash
cat <repoRoot>/.tpdc/memory/runs/<runId>.md
```

Expected structure:

```markdown
# TPDC run ship-<timestamp>-<hex>

## Execute
- **Task:** <intake title>
- **Status:** completed
- **Branch:** `tpdc/<slug>-<tail>`
- **Tool calls:** <N> across <M> turns

### Files changed (<count>)
- `<path>`
...

### Final summary
<text>

## Tests
- **Status:** all_passed
### Commands
- ✓ `<command>`
...

## PR
- **URL:** https://github.com/.../pull/<N>
- **Number:** <N>

## CI
- **Conclusion:** success
- **Local fix retries:** <N>
- **CI fix retries:** <N>
```

**Pass criteria:**
- File exists.
- Header `# TPDC run <runId>` present once.
- Sections appear in pipeline order (Execute → Tests → PR → CI). Sections from re-runs (fix-mode execute, etc.) may appear interleaved as the event log grew — that's by design.
- `## Halt` section if any stage halted, with stage + reason.

**Fail signatures:**
- File missing → ship skill didn't call `tpdc_record_run_event`. Check the ship session transcript for the calls.
- Sections malformed or out of order → recorder bug. Inspect with `head -100` and capture verbatim.
- Same section appears twice without an intervening rerun → ship skill called the tool twice for the same event. Caller bug; recorder is no-dedupe by design.

### 5d. Bonus: did the agent skip writing /memories/runs itself?

Since alpha.9, the executor prompt no longer mandates writing `/memories/runs/<runId>.md`. Look at what's in `<repoRoot>/.tpdc/memory/`:

```bash
find <repoRoot>/.tpdc/memory -type f
```

Expected:
- `runs/<runId>.md` — written by the recorder (alpha.9 contract).
- `repo-facts.md` — possibly written by the agent during execute (still in scope of the executor prompt as ad-hoc facts).

If you see the executor agent ALSO writing `runs/<otherId>.md` for the same run — that's the old prompt-driven path leaking through. The executor prompt should now skip that; if it doesn't, the prompt update didn't fully land.

---

## 6. Capture template (paste into HANDOFF post-smoke)

```markdown
## dogfood-007 result — <date>

**Task:** <verbatim>
**Repo:** <repo url>
**Final outcome:** [ ✅ success | ⚠️ partial | ❌ blocked ]
**PR:** <url>
**CI:** <success | failure | n/a>

### v0.5 capability validation

| Capability | Observed | Notes |
|---|---|---|
| web_search / web_fetch | search=<N>, fetch=<N> (or both absent) | <expected? for the task picked> |
| Compaction | events=<N> (or absent) | total inputTokens=<X>, turnCount=<M> |
| MCP-recorded summary | file present? sections=<list> | <yes/no/partial — paste 5-line excerpt> |

### Cost (TPDC visibility only)

- tpdc_execute: <X> in / <Y> out (cache_read=<Z>)
- advisor: <N> invocations (within execute)
- web_search / web_fetch: counts above
- tpdc_team_meeting (if fired): <X> in / <Y> out

### Wall-clock

- Interactive (intake → PR open): <Nmin>
- CI wait: <Nmin>

### Surprises (good or bad)

<list>

### Decision

[ tag v0.5.0 | ship alpha.10 with fix | continue with platform candidate from §7 ]
```

---

## 7. Post-smoke — proposal for what to integrate next (v0.6 chapter)

Independent of how the smoke goes, here is the ranked candidate list for the next platform-capability adoption. Discuss after capture, before the next alpha.

### Candidate 1 (RECOMMENDED): **Extended thinking on plan + advisor**

The `thinking` request parameter lets Claude allocate a private reasoning budget before emitting its final answer. We currently rely on the advisor (Opus 4.7) as a fallback when the executor faces a hard decision; extended thinking would give the executor itself more reasoning headroom without a separate API call — and would help intake/plan converge faster on ambiguous specs.

- **Where it lands:** intake skill and plan skill prompts get an optional `thinking_budget`. Execute keeps advisor; advisor itself becomes thinking-aware if Opus 4.7 supports it.
- **Risk:** low. Thinking is additive to existing requests; surface change is one optional field.
- **Validation cost:** ~1 alpha + 1 dogfood. We'd want to compare a deliberately-ambiguous intake against a paired run with thinking disabled.

### Candidate 2: **Server-side code execution sandbox** (`code_execution_*`)

The `run-tests` stage currently shells out to the user's local machine via the worktree. Replacing that with the platform's sandbox would decouple TPDC from local Node versions, package managers, and OS quirks. The agent could run tests in a clean container.

- **Where it lands:** new MCP tool `tpdc_run_tests_in_sandbox` parallel to the existing `tpdc_run_tests`. Skill ship gets a toggle.
- **Risk:** medium. The sandbox doesn't have access to private deps (private npm registries, monorepo siblings) by default. Some real-repo tests will fail there but pass locally — that's noise we'd have to filter.
- **Validation cost:** 1-2 alphas. Needs careful comparison against the existing local path.

### Candidate 3: **Server-side BM25 / regex search tools** (`tool_search_*`)

The agent uses `bash grep -r` to locate code; the platform offers indexed BM25 and regex tools that could be faster and produce ranked results. For very large repos this matters; for `inventario-reventa`-scale repos, it's negligible.

- **Where it lands:** add the two tools to `buildToolDefinitions`, between `text_editor` and `web_search`.
- **Risk:** low. Additive tools, agent decides when to reach for them.
- **Validation cost:** half an alpha; gains only show up on big repos, which means dogfooding against a larger target (a real production codebase) to measure value.

### Candidate 4 (backlog): **Auto-rotating advisor model**

When Opus 4.8 / Opus 5 lands, we want a clean upgrade path. A small config helper that reads the current "best Opus" from a single source-of-truth file (or a platform metadata call) eliminates the alpha churn of bumping `DEFAULT_ADVISOR_MODEL` each time.

- **Risk:** trivial.
- **Validation:** zero (purely DX). Worth doing in any alpha as a side change.

**My recommendation:** queue Candidate 1 (extended thinking) as **alpha.10**. It's the lowest-friction, highest-quality lever for the part of the pipeline (plan / intake) where TPDC's autonomy matters most. Candidates 2 and 3 are good follow-ups but neither blocks v0.5.0.

---

## 8. Important reminders

- **TPDC's cost visibility is partial.** The run summary's costs are only TPDC's MCP-tool token usage. Claude Code's session burn (intake/plan/auto-fix-ci as skills) is outside our scope — don't fabricate a "total ship cost" from the summary alone.
- **Compaction may not fire on this dogfood.** That's the expected case for a normal feature. We're validating the *wiring* (no errors from the beta flag, no schema rejection); the trigger itself only proves itself useful on heavier tasks.
- **Web tool absence is not failure.** If the picked task was inferable from existing repo conventions, the agent is right to skip web research. Capture the observation; don't grade the run on it.

---

*Runbook is single-use. If alpha.10 ships (Candidate 1), write `dogfood-008-runbook.md`.*
