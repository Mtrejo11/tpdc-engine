# Dogfood-005 — Validation Runbook (v0.4 capabilities)

*Target version: `v0.4.0-alpha.3` (post advisor instrumentation).*
*Goal: validate the 4 v0.4 capability adoptions (prompt caching, memory tool, observability via memory, advisor instrumentation) work in a real run.*

This is **shorter than dogfood-004** because the plugin/MCP setup is identical and already validated. The only new things to check are the v0.4 outputs.

---

## 1. What's new since dogfood-004

| Capability | What to observe | Where it shows up |
|---|---|---|
| Prompt caching (alpha.0) | `cacheReadInputTokens` > 0 on runs with ≥ 2 turns | `executeResult.usage.cacheReadInputTokens` |
| Memory tool (alpha.1) | Agent reads/writes `<repoRoot>/.tpdc/memory/` | Filesystem after the run |
| Observability via memory (alpha.2) | `/memories/runs/<runId>.md` exists with summary | Filesystem after the run |
| Advisor instrumentation (alpha.3) | `usage.advisor.invocations` on the result | `executeResult.usage.advisor` |

---

## 2. Pre-flight (quick)

- [ ] Engine repo at tag `v0.4.0-alpha.3`. `npm install && npm run build` done.
- [ ] Plugin re-installed in Claude Code (or hot-reloaded — depends on Claude Code version).
- [ ] `gh auth status` ✓ and push access to the target repo.
- [ ] Choose a target task (see §3).
- [ ] If `<repoRoot>/.tpdc/memory/` already has content from a previous run, **leave it as-is** — observing memory continuity is part of the test. If it's first run on this repo, the dir won't exist yet (lazy mkdir).

---

## 3. Pick a task

Three reasonable options, in order of preference for validation value:

### Option A (RECOMMENDED): Different task on `Mtrejo11/inventario-reventa`

Same repo as dogfood-004, **different** feature. Tests memory persistence (the headline v0.4 feature) — if the agent learned facts about ProductCard during dogfood-004, it should leverage them now via `/memories/repo-facts.md` (if -004's executor wrote there) or write fresh facts now.

Suggestions:

- "Add a 'mark as out of stock' action to the ProductCard"
- "Add a search/filter bar above the product list"
- "Show a low-inventory badge on cards with quantity < 5"

### Option B: Re-run the dogfood-004 task

"Mejorar la UI de los action buttons de la card" — but PR was already merged/closed. Mostly a regression check; less informative for v0.4 since the feature already exists.

### Option C: Different repo

Validates pivot generality but no memory continuity to observe. Skip unless you specifically want generality data.

**Pick A** unless you have a reason otherwise.

---

## 4. Run the smoke

In Claude Code, with the target repo as the working directory:

```
/tpdc:ship "<your chosen task>"
```

Follow the workflow — confirm at each gate as usual.

---

## 5. Capture v0.4-specific observations

While the run progresses (or after it ends), capture these:

### 5a. Prompt caching

After the execute stage completes, ask Claude Code to show you the `executeResult.usage` block from its scratchpad. Look for:

```json
"usage": {
  "inputTokens": <X>,
  "outputTokens": <Y>,
  "cacheReadInputTokens": <Z>,
  "cacheCreationInputTokens": <W>
}
```

Expected: `cacheReadInputTokens` > 0 (assuming the execute loop ran ≥ 2 turns). If it's 0 or absent in a multi-turn run, prompt caching may not be wiring correctly.

### 5b. Memory tool — what the agent wrote

After the run, inspect `<repoRoot>/.tpdc/memory/` (in the target repo). For example:

```bash
find /path/to/inventario-reventa/.tpdc/memory -type f
```

Expected outputs:
- `/memories/runs/<runId>.md` — the run summary (alpha.2 feature; persisted by the ship skill at the end).
- Possibly `/memories/repo-facts.md` if the executor wrote stable facts.
- Possibly other files the agent created mid-execute.

**If the agent didn't write to memory at all,** the prompt addendum isn't landing. Note as a finding.

### 5c. Advisor instrumentation

Same place as 5a — the `usage.advisor` block on the ExecuteResult:

```json
"advisor": {
  "invocations": <N>,
  "inputTokens": <X>,
  "outputTokens": <Y>
}
```

Expected: either present with `invocations >= 1` (advisor fired) or absent entirely (advisor didn't fire — also valid for simple tasks). The runbook expectation isn't "advisor MUST fire"; it's "if it fires, the count surfaces."

### 5d. Run summary file

If alpha.2's skill prompt landed, you should find `<repoRoot>/.tpdc/memory/runs/<runId>.md` after the run completes. Open it. Expected sections:

- Outcome + request verbatim
- PR URL
- Cost roll-up (including the advisor + cache lines)
- Wall-clock per stage
- Retry counts
- What shipped
- Surprises
- Memory facts updated

If the file is missing OR sparse (just the outcome, no metrics), the agent didn't follow the prompt fully. Note for prompt-tuning in alpha.4+.

---

## 6. Capture template (paste into HANDOFF post-smoke)

Short version this time:

```markdown
## dogfood-005 result — <date>

**Task:** <verbatim>
**Repo:** <repo url>
**Final outcome:** [ ✅ success | ⚠️ partial | ❌ blocked ]
**PR:** <url>
**CI:** <success | failure | n/a>

### v0.4 capability validation

| Capability | Observed | Notes |
|---|---|---|
| Prompt caching | cacheReadInputTokens=<X>, cacheCreationInputTokens=<Y> | <comment> |
| Memory tool | Files written: <list paths> | <comment> |
| Run summary persistence | <yes / no — file exists at /memories/runs/<id>.md?> | <comment> |
| Advisor instrumentation | usage.advisor=<JSON or "absent"> | <comment> |

### Cost (TPDC visibility only)

- tpdc_execute: <X> in / <Y> out
- advisor (within execute): <N> invocations, <X> in / <Y> out
- tpdc_team_meeting (if fired): <X> in / <Y> out

### Wall-clock

- Interactive (intake → PR open): <Nmin>
- CI wait: <Nmin>

### Surprises (good or bad)

<list>

### Decision

[ tag v0.4.0 | ship alpha.4 with fix | continue with web search/fetch as alpha.4 | other ]
```

---

## 7. Post-smoke decisions

### All four v0.4 capabilities observed cleanly ✅
- Tag `v0.4.0` and call it a release. Add a memory entry.
- Open v0.4.x or v0.5 for the remaining VISION §4 items (web search/fetch, compaction if needed, MCP tool formalization for run recording).

### One or two are ⚠️ partial / not-observed
- Diagnose: prompt issue (skill not following instructions), wiring issue (code bug), or env issue (e.g., 1-turn runs that don't benefit from cache).
- Ship alpha.4 with targeted fix. Re-smoke as dogfood-006.

### All ❌ — major regression
- Worst case. Inspect the executeResult JSON for what's missing. Could be a recent code break or a beta-flag rejection (memory-tool-2025-08-18 may have been ungated and removing it might be needed, or it may have changed names). Diagnose against the SDK + platform docs.

---

## 8. Important: cost visibility framing

Re-iterating from the runbook for ship/SKILL.md:

**TPDC only sees its MCP tool token usage.** The skills (intake, plan, auto-fix-ci) run inside Claude Code's session — their tokens are Claude Code's accounting, not TPDC's. The run summary's cost roll-up is intentionally only the TPDC-visible portion. If you want full-system cost (including skill burn), that's the Claude Code session's responsibility, not TPDC's.

Don't try to compute a "total ship cost" from the run summary alone — it'll be partial. That's by design and a v0.5+ topic (we'd need Claude Code to expose session-level usage to MCP tools, which it currently doesn't).

---

*Runbook is single-use. If alpha.4 ships, write `dogfood-006-runbook.md`.*
