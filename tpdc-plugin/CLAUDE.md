# TPDC — Technical Product Development Cycle

TPDC is an AI-powered development workflow engine that runs structured pipelines for feature development, bug fixing, refactoring, code assessment, planning, and discovery.

## How it works

TPDC commands are invoked explicitly via slash commands. Each command runs the TPDC engine pipeline (intake → design → decompose → execute → validate) with specialized normalization and rendering for the command type.

TPDC provides an MCP server (`tpdc`) that exposes the engine as structured tools. The slash commands call these MCP tools.

## Available Commands

| Command | Purpose | Mutation |
|---------|---------|----------|
| `/tpdc:develop` | End-to-end development workflow | Yes |
| `/tpdc:discovery` | Frame a vague idea before execution | No |
| `/tpdc:assess` | Security/performance/architecture audit | No |
| `/tpdc:plan` | Technical implementation plan | No |
| `/tpdc:solve` | Run full pipeline | Yes |
| `/tpdc:fix` | Bug-fix with normalization | Yes |
| `/tpdc:refactor` | Structural improvement | Yes |
| `/tpdc:show` | Inspect a workflow run | No |
| `/tpdc:diff` | Show patch diffs | No |

## Important rules

- TPDC commands must be explicitly invoked via slash commands. Do NOT auto-route arbitrary user requests through TPDC.
- For mutation commands (solve, fix, refactor, develop), always require `repo_root` when `apply` is true.
- Never apply patches silently — always show the preview and get confirmation.
- TPDC uses its own LLM adapter internally. Just pass the user's request text to the MCP tool.

## MCP Tools

The following MCP tools are available when this plugin is active:

- `mcp__plugin_tpdc_tpdc__tpdc_develop` — End-to-end workflow (feature/bug/refactor)
- `mcp__plugin_tpdc_tpdc__tpdc_discovery` — Discovery and framing
- `mcp__plugin_tpdc_tpdc__tpdc_assess` — Assessment and audit
- `mcp__plugin_tpdc_tpdc__tpdc_plan` — Implementation planning
- `mcp__plugin_tpdc_tpdc__tpdc_solve` — Full pipeline execution
- `mcp__plugin_tpdc_tpdc__tpdc_fix` — Bug-fix flow
- `mcp__plugin_tpdc_tpdc__tpdc_refactor` — Structural improvement
- `mcp__plugin_tpdc_tpdc__tpdc_show` — Run inspection
- `mcp__plugin_tpdc_tpdc__tpdc_diff` — Patch diff viewer
