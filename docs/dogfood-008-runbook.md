# Dogfood-008 — Validation Runbook (alpha.14 thinking + alpha.11 always-include)

*Target version: `v0.4.0-alpha.14` (post thinking-block count surface).*
*Goal: validate that `usage.moderator.thinkingBlocks.count > 0` when the team-meeting moderator fires with adaptive thinking, AND that the alpha.11 always-include counters (`advisor`, `webSearch`, `webFetch`) surface as `{ invocations: 0 }` cleanly on a typical run.*

Shorter than dogfood-007 — the only new observable surface since v0.5.0 is the thinking-block count + a handful of usage shape changes. Most of this runbook is making sure the right code path *fires* so we can observe it.

---

## 1. What's new since dogfood-007

| Change | Where it shows up | Pass criterion |
|---|---|---|
| Compaction disabled (alpha.10 hotfix) | `usage.compaction` absent on all runs | Always absent; no API rejection mid-run |
| Always-include usage counters (alpha.11) | `usage.advisor`, `usage.webSearch`, `usage.webFetch` always present | All three present on `executeResult.usage`, even when `invocations: 0` |
| Two-pass repo-facts update (alpha.11) | `<repoRoot>/.tpdc/memory/repo-facts.md` | Stale facts (counts, version pins) get `str_replace`d, not appended next to fresh ones |
| Beta probe helper (alpha.12) | `src/runtime/probe-beta.ts` + gated integration suite | Run with API key: 6 probes pass |
| Adaptive thinking on moderator (alpha.12) | `tpdc_team_meeting` moderator call | When team-meeting fires, the moderator uses `thinking: { type: "adaptive" }` + `output_config.effort: "high"` |
| Code execution recon (alpha.13) | `docs/code-execution-recon.md` + 2 gated probes | Docs only; no runtime change |
| **Thinking-block count (alpha.14)** | `usage.moderator.thinkingBlocks.count` | **Headline: > 0 when moderator fires** |

Two contract clarifications to keep in mind:

- **`thinkingBlocks.count` is a block count, not a token count.** The Anthropic API folds reasoning tokens into `output_tokens`. The count tells us "the model emitted N reasoning blocks", nothing about token cost. Calibrate expectations accordingly.
- **Role agents (PM / TechLead / Designer / Engineer) stay no-thinking by design.** Only the moderator gets adaptive thinking. Their `thinkingBlocks.count` should always be 0 unless a future alpha changes that.

---

## 2. Pre-flight

- [ ] Engine repo at tag `v0.4.0-alpha.14`. `npm install && npm run build` done.
- [ ] Plugin re-installed in Claude Code (or reload-plugins). Verify with `tpdc_ping` — version line should read `v0.4.0-alpha.14`.
- [ ] Gated probes pass: `ANTHROPIC_API_KEY=... npx vitest run src/runtime/probe-beta.integration.test.ts` → 6 passed.
- [ ] `gh auth status` ✓ and push access to the target repo.
- [ ] Pick a task (see §3).

---

## 3. Pick a task — deliberately ambiguous

The headline signal is `thinkingBlocks.count > 0` on the moderator. The moderator only fires if the intake stage convenes a team-meeting. Team-meeting fires when **intake can't converge after 2-3 rounds** of Q&A, OR when the user explicitly asks for multi-perspective deliberation.

For a deterministic dogfood, pick a task that genuinely needs multi-perspective input. Three reasonable shapes:

### Option A (RECOMMENDED): explicit team-meeting request

> "Improve the inventory experience for power users. I want PM, design, and engineering perspectives on what the right primary action is before we plan anything. Use the team-of-agents skill."

Why: the explicit "use the team-of-agents skill" + multi-role framing forces intake to call `tpdc_team_meeting` instead of converging alone. Deterministic firing; we get the observable signal on first try.

### Option B: deliberately vague visual ask

> "Make the inventory app feel more professional."

Why: subjective, no clear acceptance criteria, multiple reasonable directions. Intake should hit 2-3 rounds without converging, then auto-fire team-meeting. **Less deterministic** — sometimes intake converges anyway by picking a defensible interpretation. If you go this route, watch for intake just guessing and skipping team-meeting.

### Option C: an architectural question with two valid answers

> "Add analytics to the inventory dashboard. Should we use a client-only solution like umami self-hosted, or a hosted service like Plausible? I want the trade-offs surfaced before we commit."

Why: forces TechLead + Engineer perspectives. Plausible team-meeting trigger.

**Pick A** unless you specifically want to test the auto-trigger path (then B). C is good if you want a real architectural decision recorded.

---

## 4. Run the smoke

```
/tpdc:ship "<your chosen task>"
```

Follow the workflow — confirm at each gate. If team-meeting fires, you'll see it in the Claude Code transcript as a `tpdc_team_meeting` tool call.

---

## 5. Capture alpha.14-specific observations

### 5a. Did team-meeting actually fire?

Inspect the Claude Code transcript or scratchpad for a `tpdc_team_meeting` call during the intake stage. If you only see `tpdc_validate_intake_artifact` calls and no `tpdc_team_meeting`, the task wasn't ambiguous enough — switch to Option A (explicit request) and re-run.

### 5b. Thinking-block count on the moderator

In the `tpdc_team_meeting` response, find the `usage` block:

```json
{
  "usage": {
    "PM":       { "inputTokens": ..., "outputTokens": ..., "thinkingBlocks": { "count": 0, "hadRedacted": false } },
    "TechLead": { "inputTokens": ..., "outputTokens": ..., "thinkingBlocks": { "count": 0, "hadRedacted": false } },
    "Engineer": { "inputTokens": ..., "outputTokens": ..., "thinkingBlocks": { "count": 0, "hadRedacted": false } },
    "moderator":{ "inputTokens": ..., "outputTokens": ..., "thinkingBlocks": { "count": N, "hadRedacted": false } }
  }
}
```

**Pass criteria:**
- `usage.moderator.thinkingBlocks.count >= 1` (any positive integer — typically 1-3 blocks for `effort: "high"`).
- `usage.PM.thinkingBlocks.count === 0` (role agents are no-thinking).
- `usage.TechLead.thinkingBlocks.count === 0`, same for Designer / Engineer.
- `hadRedacted` typically false on Opus 4.7 with non-sensitive content. If `true`, that's still valid — the platform redacted some reasoning, the count still includes it.

**Fail signatures:**
- All counts are 0, including moderator → adaptive thinking didn't fire on the moderator. Check the moderator call's `thinking` param (it should be `{ type: "adaptive" }`).
- Role counts > 0 → unexpected; we don't pass thinking on role calls. Probable bug.
- The field is missing entirely → alpha.14 wiring failed. Check `executor.ts` is reading `response.content` correctly.

### 5c. Always-include counters (alpha.11)

On the executor's response (the `tpdc_execute` call's result):

```json
{
  "usage": {
    "inputTokens": ...,
    "outputTokens": ...,
    "cacheReadInputTokens": ...,
    "cacheCreationInputTokens": ...,
    "advisor":   { "invocations": 0 },
    "webSearch": { "invocations": 0 },
    "webFetch":  { "invocations": 0 }
  }
}
```

**Pass criterion:** all three of `advisor`, `webSearch`, `webFetch` are **present**, with `invocations: 0` when the agent didn't fire them. Pre-alpha.11 these were omitted-when-zero; if you see them absent, the alpha.11 fix didn't land.

### 5d. Compaction stays absent (alpha.10 hotfix)

`usage.compaction` should NOT appear on `executeResult.usage`. If it does, alpha.10 hotfix regressed.

### 5e. Repo-facts two-pass refresh (alpha.11)

After the run, cat `<repoRoot>/.tpdc/memory/repo-facts.md`. Look for staleness signals:
- Two contradictory lines about the same fact (e.g., "3 test suites" + "4 test suites").
- An "X test suites" line whose count doesn't match `find <repoRoot> -name '*.test.*' | wc -l`.

If you see staleness, the agent appended instead of doing the two-pass refresh — the alpha.11 prompt change isn't landing. Note the specific stale line and the run's actual change.

### 5f. MCP-recorded run summary (alpha.9)

```bash
cat <repoRoot>/.tpdc/memory/runs/<runId>.md
```

Expected: `# TPDC run <runId>` header + `## Execute`, `## Tests`, `## PR`, `## CI` sections. The same alpha.9 contract — no regression.

---

## 6. Capture template

```markdown
## dogfood-008 result — <date>

**Task:** <verbatim>
**Repo:** <repo url>
**Final outcome:** [ ✅ success | ⚠️ partial | ❌ blocked ]
**Team-meeting fired:** [ yes | no ]
**PR:** <url>
**CI:** <success | failure | n/a>

### alpha.14 validation (headline)

| Signal | Observed | Notes |
|---|---|---|
| `moderator.thinkingBlocks.count` | <N or "n/a — team-meeting didn't fire"> | <expected ≥ 1 if fired> |
| `moderator.thinkingBlocks.hadRedacted` | <bool> | |
| Role thinkingBlocks.count (PM/TL/Eng) | <list> | <expected all 0> |

### alpha.11 + alpha.10 sanity

| Signal | Observed | Notes |
|---|---|---|
| `executeResult.usage.advisor.invocations` | <N> | <present even when 0?> |
| `executeResult.usage.webSearch.invocations` | <N> | |
| `executeResult.usage.webFetch.invocations` | <N> | |
| `executeResult.usage.compaction` | <absent?> | <expected: absent> |
| repo-facts.md staleness | <none / Xline mismatch> | |
| Recorded run summary file | <present? sections=?> | |

### Cost + wall-clock

- tpdc_execute: <X> in / <Y> out (cache_read=<Z>)
- tpdc_team_meeting (if fired): <X> in / <Y> out
- Interactive wall-clock: <Nmin>

### Surprises

<list>

### Decision

[ alpha.14 validated → continue v0.6 backlog (fast-mode probe / Files API probe / etc.) |
  partial → alpha.15 with targeted fix |
  blocked → diagnose ]
```

---

## 7. Post-smoke decisions

### Headline passed ✅ (moderator thinkingBlocks > 0, no surprises)
Move to alpha.15. Top candidates per the v0.6 backlog:
1. **Probe + adopt `fast-mode-2026-02-01`** — latency optimization probe. Role agents fire in parallel during team-meeting; if fast-mode is accepted on Sonnet 4.6, this is a wall-clock win.
2. **Files API + container_upload probe** — first step toward code execution wireup. Documents the upload mechanism without committing to the full sandbox tool.
3. **Update HANDOFF.md** — alpha.7 → alpha.14 still not in HANDOFF (entries from before v0.5.0 tag only). Housekeeping.

### Headline partial ⚠️
The most likely failure modes:
- Team-meeting didn't fire (task too clear). Re-run with Option A's explicit-request task.
- `thinkingBlocks` field exists but count is 0 on moderator. Check that `team-meeting.ts` is sending `thinking: { type: "adaptive" }` (not `enabled`).
- Field is missing entirely. Check `executor.ts` content-scan logic — possible the parsed response shape differs from expectation.

### Headline blocked ❌
Either API regression on adaptive thinking (re-run probe `npx vitest run src/runtime/probe-beta.integration.test.ts` to confirm it still passes) or a real bug in the alpha.14 wiring. Diagnose against the unit tests in `src/runtime/probe-beta.test.ts` + `src/teams/team-meeting.test.ts` — those cover the wiring without API access.

---

## 8. Cost + caveats

- Team-meeting per fire: ~$0.30 ($0.10 role agents in parallel + $0.20 moderator). With adaptive thinking on the moderator, expect a small bump (~+$0.05) for the reasoning tokens included in `output_tokens`.
- Total run cost (intake → PR open with team-meeting fired once): plausibly $0.50-1.50 depending on execute loop length.
- `thinkingBlocks.count` is observation-only, not a budget knob. The way to dial reasoning intensity remains `moderatorThinkingBudget` in `RunTeamMeetingOptions` (mapped to `output_config.effort` internally).

---

*Runbook is single-use. If alpha.15 ships, write `dogfood-009-runbook.md`.*
