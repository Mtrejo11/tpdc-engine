# Code execution sandbox — reconnaissance (alpha.13)

*Status: SDK + types surveyed; gated integration probes added in `src/runtime/probe-beta.integration.test.ts`. **No production code changes** in alpha.13 — this doc captures what we learned and the open questions the next alpha needs to answer before building `tpdc_run_tests_in_sandbox`.*

---

## What's available

The Anthropic platform exposes a server-side **code execution** tool that runs code in a gVisor-isolated container. SDK 0.78 types three variants:

| Tool type | Notes |
|---|---|
| `code_execution_20250522` | Earliest variant. No REPL persistence, no doc on container model. |
| `code_execution_20250825` | Container model introduced. |
| `code_execution_20260120` | **REPL state persistence via gVisor checkpoint** — state carries across turns within the same container. |

All three have the same tool def shape (`name: "code_execution"`, `allowed_callers`, `cache_control`, `defer_loading`, `strict`). The agent emits code blobs as `tool_use` inputs; the platform runs them and returns `code_execution_tool_result` blocks.

**Three execution flavors** live alongside the canonical `code_execution`:

- `bash_code_execution` — shell command execution. Returns `bash_code_execution_result` with `stdout`, `stderr`, `return_code`, `content: BashCodeExecutionOutputBlock[]` (output files referenced by `file_id`).
- `text_editor_code_execution` — file editing inside the container.

**Container lifecycle** (`BetaContainer` / `BetaContainerParams`):
- Each request can associate with a container by `id`; if omitted, the platform creates one.
- Containers have an `expires_at`. The exact TTL is platform-managed (not surfaced).
- Containers can have **skills** pre-loaded (`BetaContainerParams.skills?`). The skill model is the same `BetaSkill` shape used elsewhere.

**File uploads** (`BetaContainerUploadBlockParam { file_id, type: "container_upload" }`):
- Files are uploaded to the Anthropic Files API first → you get back a `file_id`.
- That `file_id` becomes a `container_upload` content block in the user message → file lands in the container's input directory.

**Beta header:** `code-execution-2025-05-22`.

---

## What the probes will tell us

The two probes added in alpha.13 are minimal — they only confirm the API accepts the tool definitions + beta header, not that the full workflow works. They answer:

1. Does the API serve `code_execution_20260120` (with REPL persistence) on Sonnet 4.6?
2. Does the API serve `code_execution_20250825` as a fallback?

Run with:

```bash
ANTHROPIC_API_KEY=... npx vitest run src/runtime/probe-beta.integration.test.ts
```

Outcomes feed into the alpha.14 build/defer decision below.

---

## Open questions (decide before any wireup)

These are NOT yet answered. Each requires either a deeper probe (multi-turn agent test against the API) or documentation lookup. The MCP tool surface for `tpdc_run_tests_in_sandbox` cannot be designed without answers to at least 1, 4, 5.

### 1. How do we get the worktree into the container?

The local `tpdc_run_tests` reads from `<worktreePath>` on disk. The sandbox container is fresh by default.

Options:
- **a)** Upload every file in the worktree via the Files API → reference each as a `container_upload` block. Cost scales linearly with file count. For a small change (5 files modified, 20 files in the project) this is cheap; for a monorepo it's prohibitive.
- **b)** Initialize the container by `git clone <user-repo>` + apply a patch. Requires the container to have network access to the user's git remote and credentials. Probably won't work for private repos.
- **c)** Diff-only upload: upload only modified files, assume the container has a recent snapshot of the repo. Requires a snapshot-keeping mechanism we'd own.

Recommendation: probe option (a) with a tiny fixture (3 files, < 1KB each) to measure latency before deciding.

### 2. How do dependencies get installed?

The container starts with a base OS image (likely Ubuntu with common toolchains). For a Node test run we need `npm install` to fetch packages — requires network access.

- Public npm packages: should work if the container has outbound network.
- Private npm registries (`@scope` with auth): require `.npmrc` injection or a private mirror. Not solved by default.
- Lockfile pinning: `package-lock.json` / `bun.lock` / `pnpm-lock.yaml` should be uploaded with the worktree (option 1a).

For `inventario-reventa` (which uses bun): the container needs `bun` installed. Is it pre-baked? Or do we install it as a step?

### 3. Which runtime does the container ship with?

We don't know what Node version (or Python, Go, etc.) the platform's container provides by default. For a repo with `.nvmrc` pinning Node 18 LTS, a Node 22 container would silently change behavior.

Mitigations:
- Install the pinned runtime as a setup step (e.g., `curl -fsSL https://bun.sh/install | bash`).
- Use `BetaSkill` pre-loaded skills if Anthropic offers a "Node toolchain" skill.

### 4. What does a full end-to-end test run look like?

We need to run something like:

```bash
# Inside the container:
cd /workspace
bun install            # or npm install / pnpm install
bun test               # or whatever plan.testCommands says
```

…and parse the result. The `bash_code_execution_result.return_code` gives us pass/fail; `stdout`/`stderr` gives us the test output. So the **shape is workable**. The question is whether the latency + cost is competitive with local execution.

Latency baseline: local `bun test` in `inventario-reventa` runs in ~6s. A sandbox round trip plausibly takes 30-60s when you include container init + file upload + install + run. The sandbox path would be slower.

### 5. When is the sandbox path the right default?

The local path works when:
- The user has the right toolchain installed.
- All deps are accessible (public npm, internal npm with proper auth setup).
- The test suite doesn't depend on platform-specific binaries.

The sandbox path becomes valuable when:
- The user is on a CI machine without dev tooling.
- The user wants a clean environment for reproducibility.
- The user's local env is broken (which is the original motivation).

A reasonable default policy: **local first, sandbox as opt-in fallback**. The ship skill could add a `--use-sandbox` flag for users who want it; auto-fallback on local errors is a noisier design.

---

## Recommendation for alpha.14

**Defer the production wireup unless we have a concrete user case.** Reasoning:

- The friction list above (deps, runtime, file upload cost) means a "first-draft" `tpdc_run_tests_in_sandbox` would be **worse** than local for most users — slower latency, lower coverage of private deps.
- The probes added in alpha.13 confirm the wiring is doable; that's enough for now.
- The capability is best built when there's a real ask: "my CI box doesn't have Node and I want TPDC to run tests anyway" or "my local env is corrupted." Both are valid asks but not the current bottleneck.

If/when we build it, the order is:
1. Multi-file fixture: upload 3-5 files, run a trivial bash command, measure round-trip latency.
2. Real-repo fixture: clone `tpdc-smoke` into a container, run its tests, compare against local.
3. Design `tpdc_run_tests_in_sandbox` MCP tool with `containerSetup` / `installCommands` / `testCommands` separation.
4. Ship skill toggle: `--use-sandbox` opt-in; never auto-fallback silently.

For alpha.14 itself, candidates from the unaffected backlog:

- **Files API surface for run summaries** — upload the final run-summary markdown to the platform (alongside the local memory file) so cross-Claude-Code-session visibility is possible. Low risk, additive.
- **Skills pre-loading for the executor's container** — if/when we DO use sandbox, the executor's `code_execution` calls could come pre-loaded with a "TPDC dev skills" container. Forward-looking, depends on this work.
- **Extended thinking surfaced in usage** — Mauricio's note from chapter v0.6 close: the moderator now uses `{ adaptive }` + `effort` but the reasoning token count isn't surfaced in `usage.thinking`. Small alpha (~30 min) closing a loose end.

My pick for alpha.14: **surface thinking usage**. Smaller, predictable, closes a known gap.

---

*Doc owner: this file. Update with probe outcomes once `npx vitest run src/runtime/probe-beta.integration.test.ts` is run with API key, and with any platform doc changes that answer the open questions above.*
