# TPDC Engine

AI-powered development workflow engine with structured pipelines for feature development, bug fixing, refactoring, code assessment, planning, and discovery.

Installable as a **Claude Code plugin** or usable as a **standalone CLI**.

## Quick Start

### As a Claude Code Plugin

```bash
# Inside Claude Code:
/plugin marketplace add Mtrejo11/tpdc-engine
/plugin install tpdc@tpdc
/reload-plugins
```

Then use any command:
```
/tpdc:show
/tpdc:discovery "We need to add real-time notifications to the app"
/tpdc:fix "Login form crashes on empty email submission"
```

### As a Standalone CLI

```bash
npx tpdc show
npx tpdc solve "Add password reset flow with email verification"
npx tpdc fix "Dashboard charts don't render on Safari"
```

### From Source

```bash
git clone https://github.com/Mtrejo11/tpdc-engine.git
cd tpdc-engine
npm install
npm run build
node dist/cli.js show
```

---

## Commands

### Execution Commands

| Command | Purpose | Mutation | Example |
|---------|---------|----------|---------|
| `solve` | Run the full pipeline | Yes | `tpdc solve "Add password reset flow with email verification"` |
| `fix` | Bug-fix with input normalization | Yes | `tpdc fix "Login form crashes on empty email submission on iOS"` |
| `refactor` | Structural improvement | Yes | `tpdc refactor "Extract authentication logic into a dedicated service"` |
| `develop` | End-to-end orchestrated workflow | Yes | `tpdc develop feature "Add user profile settings page"` |

### Analysis Commands (Safe Mode Only)

| Command | Purpose | Example |
|---------|---------|---------|
| `discovery` | Frame a vague idea before execution | `tpdc discovery "We need to add real-time notifications"` |
| `assess` | Security, performance, or architecture audit | `tpdc assess "Evaluate SQL injection risks in the search API"` |
| `plan` | Technical implementation plan with phases | `tpdc plan "Migrate from REST to GraphQL"` |

### Inspection Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `show` | List recent runs or inspect a specific run | `tpdc show` / `tpdc show d2ae7adf` |
| `diff` | Show patch diffs for a mutation run | `tpdc diff d2ae7adf` |

---

## How It Works

Every command runs through the TPDC engine pipeline:

```
intake → design → decompose → execute → validate
```

Each stage is powered by a pluggable **capability** — an LLM prompt with input/output schema validation.

### Pipeline Stages

| Stage | What It Does |
|-------|-------------|
| **Intake** | Normalizes the request into a structured ticket with acceptance criteria |
| **Design** | Produces an Architecture Decision Record (ADR) with scope, risks, alternatives |
| **Decompose** | Breaks the design into ordered implementation steps with dependencies |
| **Execute** | Generates execution artifacts or patches (safe or mutation mode) |
| **Validate** | Evaluates execution quality, scores 0-100, surfaces findings |

### Execution Modes

**Safe mode** (default): Analyzes and plans without touching any files.

**Mutation mode** (`--apply`): Generates patches, validates them via dry-run, shows a preview, and applies after confirmation.

```bash
tpdc fix "Bug description" --apply --repo-root ~/my-project
```

Mutation flow:
```
execute-patch → dry-run → preview → confirmation → git apply → validate
```

---

## Command Details

### `solve`

Full pipeline execution. The general-purpose command.

```bash
tpdc solve "Add two-factor authentication to the login flow"
tpdc solve "Implement dark mode" --apply --repo-root ~/project
```

### `fix`

Bug-fix flow. Normalizes bug reports by extracting platform, component, actual/expected behavior. If context is missing, suggests a clarified bug report.

```bash
tpdc fix "Dashboard charts don't render on Safari 17"
tpdc fix "Form validation error messages disappear after 1 second on Android"
```

Output includes: detected context, missing fields, validation checklist, suggested clarified input.

### `refactor`

Structural improvement without changing functional behavior. Detects the refactor category automatically:

| Category | Triggers |
|----------|----------|
| Extraction | extract, pull out, move to, factor out |
| Decomposition | split, break down, decompose |
| Consolidation | consolidate, merge, centralize, DRY |
| Simplification | simplify, remove, clean up, flatten |
| Architecture | introduce layer, decouple, separate concerns |

```bash
tpdc refactor "Extract payment processing into a dedicated service"
tpdc refactor "Split the UserProfile component into smaller sub-components"
tpdc refactor "Consolidate duplicate API error handling across services"
```

Output includes: targets, risk level (low/medium/high), structural issues, strategy, affected files, expected benefits.

### `assess`

Analysis/audit mode. Auto-detects the assessment category:

| Category | Triggers |
|----------|----------|
| Security | security, vulnerability, XSS, auth, token, encryption |
| Performance | performance, latency, bottleneck, memory, render |
| Architecture | architecture, coupling, separation of concerns, SOLID |

```bash
tpdc assess "Evaluate SQL injection risks in the search API"
tpdc assess "Analyze rendering performance on the dashboard page"
tpdc assess "Review module coupling between auth and user services"
```

Output includes: scope, findings by risk level (critical/high/medium/low), evidence, recommended actions.

### `plan`

Technical implementation plan without generating patches.

```bash
tpdc plan "Migrate from REST to GraphQL"
tpdc plan "Add end-to-end encryption for direct messages"
```

Output includes: objective, scope, ordered phases with dependencies, likely files, validation approach, readiness status.

### `discovery`

Pre-execution framing for vague ideas. Classifies questions as critical (blocking) or informational (non-blocking).

```bash
tpdc discovery "We need to add real-time notifications to the app"
tpdc discovery "We want to support offline mode for mobile users"
```

Output includes: problem framing, affected areas, impact areas, tradeoffs, decision drivers, readiness (ready/needs_input/not_ready), suggested next command.

### `develop`

End-to-end orchestrated workflow. Chains existing commands step by step.

```bash
tpdc develop feature "Add user profile settings page"     # discovery → plan → solve
tpdc develop bug "Checkout fails on expired session"       # fix (with context validation)
tpdc develop refactor "Decouple the notification module"   # refactor
```

Stopping rules:
- Discovery not ready → stops, shows critical questions
- Plan blocked → stops, shows blockers
- Fix blocked → stops, shows missing context
- Confirmation declined → summarizes without mutation

### `show`

Inspect workflow runs.

```bash
tpdc show                  # List recent runs
tpdc show d2ae7adf         # Inspect specific run (partial ID match)
```

### `diff`

Show patch diffs for mutation runs with color-coded output.

```bash
tpdc diff d2ae7adf
```

---

## Capabilities

The engine ships with 6 installed capabilities:

| Capability | Stage | Version |
|-----------|-------|---------|
| `intake` | Intake | 0.1.0 |
| `design` | Design | 0.1.0 |
| `decompose` | Decompose | 0.1.0 |
| `execute` | Execute (safe) | 0.1.0 |
| `execute-patch` | Execute (mutation) | 0.1.0 |
| `validate` | Validate | 0.1.0 |

Each capability is a bundle containing:
- `capability.json` — manifest (id, version, stage)
- `prompt.md` — system prompt for the LLM
- `input.schema.json` — input validation schema
- `output.schema.json` — output validation schema

```bash
tpdc list-capabilities     # List all installed capabilities
tpdc install-capability <path>  # Install a new capability bundle
```

---

## Self-Learning Loop

TPDC learns from its own runs. After every workflow:

1. **Extract** — derives lessons from blocked runs, findings, dry-run failures, mutation outcomes
2. **Aggregate** — merges patterns into `memory/lessons.json` (deduplicates, counts occurrences)
3. **Inject** — prepends relevant prior lessons as context hints to future workflow requests

Example: if 3 prior `fix` runs blocked because platform wasn't specified, the next `fix` run gets:
```
Context from prior TPDC runs:
Prior learnings (from past runs):
- Requests involving mobile features should specify the target platform (iOS/Android/both) (seen 3x)
```

---

## LLM Adapters

The engine supports multiple LLM backends:

| Adapter | Config | Use Case |
|---------|--------|----------|
| **Claude Code CLI** (default) | `TPDC_ADAPTER=cli` | Uses Max subscription tokens via `claude --print` |
| **Claude API** | `TPDC_ADAPTER=api` + `ANTHROPIC_API_KEY` | Direct API calls |
| **Mock** | `TPDC_ADAPTER=mock` | Testing with stub responses |

Set the model:
```bash
TPDC_MODEL=opus tpdc solve "Complex architectural request"
```

---

## Mutation Mode

Commands that support mutation (`solve`, `fix`, `refactor`, `develop`) can generate and apply patches:

```bash
tpdc fix "Bug description" --apply --repo-root ~/my-project
tpdc fix "Bug description" --apply --confirm-apply --repo-root ~/my-project  # Non-interactive
tpdc fix "Bug description" --apply --interactive --repo-root ~/my-project     # Prompt before apply
```

The mutation flow:
1. **Patch generation** — LLM produces unified diffs grounded in actual file content
2. **Dry-run** — validates patches against current files (context line matching, safety checks)
3. **Preview** — shows files, operations, diffs, and what will happen
4. **Confirmation** — user confirms before any files are touched
5. **Git apply** — creates a branch, applies patches, commits
6. **Validate** — evaluates the applied changes

No silent applies. Ever.

---

## Artifacts

Every run persists structured artifacts to `artifacts/<workflowId>/`:

```
artifacts/wf_1773635212409_d2ae7adf/
├── intake.json              # Structured ticket
├── design.json              # Architecture Decision Record
├── decompose.json           # Implementation plan
├── execute.json             # Execution artifacts
├── validate.json            # Evaluation + score
├── workflow.json            # Run metadata
├── learning.json            # Extracted lessons
├── summary.md               # Human-readable summary
├── *.lineage.json           # Stage lineage metadata
└── *.raw.txt                # Raw LLM outputs
```

---

## Claude Code Plugin

### Plugin Structure

```
tpdc-plugin/
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   └── marketplace.json     # Marketplace config
├── .claude/
│   └── settings.json        # Plugin settings
├── .mcp.json                # MCP server registration
├── CLAUDE.md                # Instructions for Claude
├── README.md                # Plugin docs
└── skills/
    ├── assess/SKILL.md
    ├── develop/SKILL.md
    ├── diff/SKILL.md
    ├── discovery/SKILL.md
    ├── fix/SKILL.md
    ├── plan/SKILL.md
    ├── refactor/SKILL.md
    ├── show/SKILL.md
    └── solve/SKILL.md
```

### MCP Server

The plugin provides a stdio MCP server with 9 tools:

| Tool | Description |
|------|-------------|
| `tpdc_develop` | End-to-end workflow (feature/bug/refactor) |
| `tpdc_discovery` | Discovery and framing |
| `tpdc_assess` | Assessment and audit |
| `tpdc_plan` | Implementation planning |
| `tpdc_solve` | Full pipeline execution |
| `tpdc_fix` | Bug-fix flow |
| `tpdc_refactor` | Structural improvement |
| `tpdc_show` | Run inspection |
| `tpdc_diff` | Patch diff viewer |

### Slash Commands

After installing the plugin, these slash commands are available in Claude Code:

```
/tpdc:develop feature "Add user profile settings page"
/tpdc:discovery "We want to support offline mode"
/tpdc:assess "Evaluate SQL injection risks in the search API"
/tpdc:plan "Migrate from REST to GraphQL"
/tpdc:solve "Add two-factor authentication"
/tpdc:fix "Login form crashes on empty email submission"
/tpdc:refactor "Extract payment processing into a service"
/tpdc:show
/tpdc:diff d2ae7adf
```

---

## Installation

### Option 1: Claude Code Plugin (Recommended)

```bash
# Inside Claude Code:
/plugin marketplace add Mtrejo11/tpdc-engine
/plugin install tpdc@tpdc
/reload-plugins
```

### Option 2: npm Global Install

```bash
npm install -g tpdc-engine
tpdc show
tpdc solve "Your request"
```

### Option 3: npx (No Install)

```bash
npx tpdc-engine show
npx tpdc-engine solve "Your request"
```

### Option 4: From Source

```bash
git clone https://github.com/Mtrejo11/tpdc-engine.git
cd tpdc-engine
npm install
npm run build
node dist/cli.js show
```

### Uninstall

```bash
# Claude Code plugin:
/plugin uninstall tpdc@tpdc
/plugin marketplace remove tpdc

# npm:
npm uninstall -g tpdc-engine
```

---

## Architecture

```
src/
├── cli.ts                  # CLI entry point (9 commands)
├── index.ts                # Library exports
├── mcp/                    # MCP stdio server
├── integration/            # Claude integration (parser, dispatcher, develop orchestrator)
├── runtime/                # Workflow orchestrator + LLM adapters
├── plugin/
│   ├── handlers/           # Normalizers + artifact builders per command
│   └── renderers/          # CLI + markdown renderers per command
├── learning/               # Self-learning loop (extract, store, inject)
├── patch/                  # Patch system (parse, dry-run, safety, apply, git)
├── protocols/              # Bundled schemas (intake, design, plan, execution, eval)
├── registry/               # Capability loader
├── storage/                # Run persistence + summary generation
└── orchestrator/           # Pipeline coordination

capabilities/installed/     # 6 capability bundles
tpdc-plugin/                # Claude Code plugin package
artifacts/                  # Workflow run outputs (gitignored)
memory/                     # Learning store (gitignored)
```

---

## Testing

795 tests across 10 suites:

```bash
npm run test:fix            # 40 tests — bug normalizer + renderer
npm run test:assess         # 47 tests — assessment normalizer + renderer
npm run test:discovery      # 95 tests — discovery artifact + readiness + renderer
npm run test:refactor       # 103 tests — refactor categories + risk + renderer
npm run test:plan           # 85 tests — plan artifact + phases + renderer
npm run test:learning       # 48 tests — extraction, aggregation, injection
npm run test:mutation-ux    # 66 tests — preview, apply, rollback, show/diff
npm run test:integration    # 81 tests — parser, dispatcher, Claude integration
npm run test:develop        # 84 tests — orchestrator flows + stopping rules
npm run test:mcp-plugin     # 146 tests — MCP tools, skills, manifests, plugin structure
```

CI runs on every push via GitHub Actions.

---

## Troubleshooting

### MCP server not starting
```bash
# Verify the build exists:
ls ~/.claude/plugins/marketplaces/tpdc/dist/mcp/server.js

# Install dependencies if missing:
cd ~/.claude/plugins/marketplaces/tpdc && npm install

# Test the server manually:
node ~/.claude/plugins/marketplaces/tpdc/dist/mcp/server.js
```

### Commands not appearing after plugin install
```
/reload-plugins
```
Check `/plugin` → Installed tab → verify `tpdc@tpdc` is enabled.

### Workflow blocks with missing context
This is intentional. The engine blocks when critical information is missing (platform, component, desired behavior). Provide the missing context and re-run.

### LLM adapter errors
```bash
# Use Claude Code CLI (default, uses Max subscription):
TPDC_ADAPTER=cli tpdc solve "request"

# Use direct API:
ANTHROPIC_API_KEY=sk-... tpdc solve "request"

# Use mock for testing:
TPDC_ADAPTER=mock tpdc solve "request"
```

---

## License

MIT
