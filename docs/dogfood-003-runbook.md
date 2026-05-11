# Dogfood-003 — Validation Runbook

*Target version: v0.2.0-alpha.3-rc3 (post Build Session 2).*
*Goal: validate the team-of-agents intake convergence against the same vague task that broke dogfood-002.*

This runbook is meant to be executed end-to-end in one sitting (~30-60 min). If a step fails, capture the failure mode in §10 and decide whether to ship a fix as `rc4` or tag `v0.2.0-alpha.3` if the failure is unrelated to D6.

---

## 1. Pre-flight checklist

Tick each before you start. Anything that's missing will only surface mid-smoke and be more annoying then.

- [ ] On branch `main` at commit tagged `v0.2.0-alpha.3-rc3`
- [ ] `npm install` clean, `dist/` fresh (`npm run build`)
- [ ] `npm test` passes — should report **188 passed, 3 skipped** (the 3 skipped are integration tests gated by API key)
- [ ] `gh auth status` shows logged in with push access to `Mtrejo11/inventario-reventa`
- [ ] `ANTHROPIC_API_KEY` in your shell
- [ ] `GITHUB_WEBHOOK_SECRET` exported (any random string)
- [ ] `cloudflared` (or `ngrok`) available
- [ ] Webhook on `Mtrejo11/inventario-reventa` configured to your tunnel URL, listening for **Check suites** only (see README §"Configure the GitHub repo")
- [ ] No stale `tpdc/worktrees/dogfood-003*` directories under `Mtrejo11/inventario-reventa/.tpdc/`. If any exist, `git worktree remove` them.

---

## 2. Optional pre-smoke: team-meeting integration test

This runs the team meeting helper in isolation against the real API (no Inngest, no GitHub). ~$0.30, ~2 min. Catches prompt drift / schema drift before the full smoke. Recommended.

```bash
cd ~/Documents/Personal/tpdc-engine
ANTHROPIC_API_KEY=sk-ant-... npx vitest run src/teams/team-meeting.integration.test.ts
```

**Expected:** test passes. The console log shows `consensus`, `escalated`, `answersCount`, `assumptionsCount`, `dissentCount`, and per-role usage. If escalation is null and answers are populated, the meeting is healthy. If escalation has a reason, inspect — it's allowed but unusual on this fixture.

If the test fails (schema validation, model refusal, etc.), STOP and diagnose before the full smoke.

---

## 3. Start the local stack

In three terminals:

```bash
# Terminal 1 — TPDC server
cd ~/Documents/Personal/tpdc-engine
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_WEBHOOK_SECRET=...
npm run dev

# Terminal 2 — Inngest dev server (UI at :8288)
cd ~/Documents/Personal/tpdc-engine
npm run inngest:dev

# Terminal 3 — public tunnel
cloudflared tunnel --url http://localhost:3000
```

Confirm in browser: `http://localhost:8288` shows the `ship-feature` function registered.

If the GitHub webhook URL changed (tunnel restarted), update it in the repo settings.

---

## 4. Fire the event

The payload deliberately mirrors `dogfood-002` (same repo, same task, same `runId` family with `-003` suffix) so the comparison is apples-to-apples. The new fields request **hybrid mode** with explicit defaults.

```bash
curl -X POST http://localhost:8288/e/test-key \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tpdc/feature.requested",
    "data": {
      "runId": "dogfood-003",
      "request": "Mejorar la UI de los action buttons de la card",
      "repoRoot": "/Users/mtrejodev/path/to/Mtrejo11/inventario-reventa",
      "intakeMaxAttempts": 5,
      "teamMeetingMode": "hybrid",
      "teamMeetingNAttempts": 2,
      "teamMeetingHybridTimeout": "30m"
    }
  }'
```

Replace `repoRoot` with the actual local path on your machine.

**Why hybrid + N=2:** matches the default flow we expect production users to hit. If something breaks, it's in the realistic codepath.

---

## 5. Expected flow

Watch in the Inngest UI at `http://localhost:8288/runs`. The workflow should progress through:

1. **Attempt 1 — intake fresh.** If `readiness=needs_input` (likely for this vague task), the workflow emits `tpdc/intake.unblock_requested` and waits on **long timeout** (1d) — this is per spec because attempt 1 ≤ N=2.

2. **You answer** with `tpdc unblock`. Example:
   ```bash
   cat > /tmp/dogfood-003-answers-1.json <<'EOF'
   [
     { "question": "<read from Inngest UI>", "answer": "<your answer>" }
   ]
   EOF
   node dist/cli/index.js unblock dogfood-003 --answers /tmp/dogfood-003-answers-1.json
   ```

3. **Attempt 2 — intake with Q&A augmented.** If still `needs_input`, repeat: long-wait, you answer.

4. **Attempt 3 — intake with more Q&A.** If still `needs_input`, **don't answer this time.** The workflow is in `short_human_wait_then_team` strategy (attempt 3 > N=2). It waits **30m**; let it time out (or skip ahead with `sleep 30m` if you want to wait, OR set a shorter `teamMeetingHybridTimeout` in step 4's payload like `"30s"` for fast iteration).

5. **Team meeting fires.** You should see in the Inngest UI:
   - 4 (or 3, if Designer skipped) `runExecutor`-style API calls in parallel
   - 1 Opus moderator synthesis call
   - Event `tpdc/team-meeting.completed` with the full result payload
   - Augmented request fed into intake attempt 4

6. **Attempt 4 — intake with team's assumptions.** Should converge (`readiness=ready`).

7. **Plan → Execute → Tests → Push → PR → CI loop.** Standard pipeline.

8. **Done.** PR open on `Mtrejo11/inventario-reventa`, CI green (or auto-fixed green).

---

## 6. Success criteria (spec §10.3)

Map your run to each. Mark with ✅ / ❌ / ⚠️ (partial).

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Intake reaches the team meeting trigger | | tpdc/team-meeting.completed event present in Inngest log |
| 2 | Team meeting returns valid synthesis (no recursion) | | `consensus` boolean set, `answers.length >= 1`, no second meeting fired |
| 3 | Plan stage proceeds (no halt in intake) | | Run reaches `runPlan` step after the meeting |
| 4 | Execute reaches completion (or non-intake failure) | | `runExecute` returns `status: "completed"` or `"max_turns_exceeded"` |
| 5 | Cost < $1 full run | | Sum usage from Inngest UI (intake + plan + meeting + execute) |

### Bonus — alpha.2 fixes validation (if execute runs)

| # | Fix | Status | Evidence |
|---|---|---|---|
| A | MAX_TURNS=60 sufficient | | `runExecute` doesn't hit `max_turns_exceeded` for a normal task |
| B | WIP recovery on max_turns | | If max_turns hit: `executeResult.commitSha` non-empty, branch pushed as draft PR |
| C | tool_call events visible mid-flight | | `tpdc/execute.tool_call` events streaming in Inngest UI during the agent loop |

---

## 7. Compare to dogfood-002

The original failure mode for `dogfood-002`:
- Intake halted at `attempt=3` with `maxAttempts=3` (old default).
- No team meeting (didn't exist yet).
- 0 executions, $0.05 cost, value = 0.

For `dogfood-003` to count as a win:
- Either the workflow reaches **execute** (best case), OR
- The team meeting fires and produces a structured synthesis (still a partial win — proves the convergence mechanism works even if downstream stages have other issues).

If neither happens, capture what blocked it and consider whether `rc4` is warranted or whether the issue is a known-out-of-scope gap.

---

## 8. What to capture for the HANDOFF update

When the run finishes (success or fail), capture:

1. **Final state** — Inngest UI top-level run status. `success`, `failed`, or `running` (timed out / stuck).
2. **Intake attempts** — how many, where did it converge.
3. **Team meeting fired?** — yes/no. If yes: roles convened, consensus, escalated, dissent count, cost.
4. **Augmented request next attempt** — paste the relevant `intake-attempt-N` step's user input (the markdown the team meeting produced).
5. **Plan output** — N steps, riskLevel.
6. **Execute output** — turn count, tool call count, files changed, finalSummary.
7. **PR link** — if opened. CI status final.
8. **Total cost** — sum from Inngest UI usage data.
9. **Total wall-clock** — start to PR-CI-green.
10. **Surprises** — anything unexpected (good or bad). These become memory entries.

---

## 9. Post-smoke decisions

### If §6 has all ✅:
- Tag `v0.2.0-alpha.3` (drop the `-rc3`):
  ```bash
  git tag v0.2.0-alpha.3
  git push origin v0.2.0-alpha.3
  ```
- Update HANDOFF: alpha.3 shipped. Open the next chapter (plan-stage team meeting? CLI surface for `tpdc ship`? alpha.4 scope?).
- Add a memory entry capturing what worked + cost numbers from a real run.

### If §6 has ⚠️ partial or ❌ on D6-specific criteria (1-3):
- Don't tag. Fix and ship `rc4`.
- File a TODO #25 with the specific failure mode. Update HANDOFF.

### If §6 ✅ on 1-3 but ❌ on 4-5 (execute/cost):
- The team-of-agents work succeeded. The downstream gaps are not D6. Tag `v0.2.0-alpha.3` and capture the execute/cost issue as a new alpha.4 scope item.

---

## 10. Failure capture template

If the smoke breaks, fill this in and paste into a fresh `dogfood-003-results.md` (or directly into HANDOFF):

```
## dogfood-003 result — <date>

**Outcome:** [ ✅ success | ⚠️ partial | ❌ blocked ]

**Where it stopped:** <stage + step name from Inngest>

**Symptoms (verbatim):**
<paste error message / log excerpt>

**Diagnosis:** <root cause if known, hypotheses otherwise>

**Decision:** [ tag alpha.3 | ship rc4 with fix | escalate as new TODO ]

**Cost:** $<X>
**Wall-clock:** <Ymin>
**Intake attempts:** <N>
**Team meeting fired:** [ yes | no ]
**PR opened:** <URL or "no">
```

---

*This runbook is single-use per dogfood iteration. If `rc4` ships, write `dogfood-004-runbook.md` rather than mutating this one — the diff between runbooks captures what we learned each round.*
