# TPDC Plugin for Claude Code

AI-powered development workflow engine with structured pipelines for feature development, bug fixing, refactoring, assessment, planning, and discovery.

## Prerequisites

- [Claude Code](https://claude.ai/claude-code) installed
- Node.js 20+
- The TPDC engine must be built before the plugin can function
- **Anthropic API key** for `tpdc_execute` and `tpdc_team_meeting` (direct API calls; not the same as your Claude Code subscription). The MCP launcher (`start-mcp.sh`) loads, in order: `~/.config/tpdc/env` then `<engine-root>/.env` (gitignored). Use `ANTHROPIC_API_KEY=sk-ant-...` lines there — do not paste secrets into committed `.mcp.json`.
- **`TPDC_ENGINE_ROOT` (optional)** — Claude installs the plugin under `~/.claude/plugins/cache/...` and often **only** copies `tpdc-plugin/`, which does **not** include the compiled `dist/` from the monorepo root. If MCP fails with “missing …/dist/mcp/server.js”, either: (1) `export TPDC_ENGINE_ROOT=/absolute/path/to/tpdc-engine` in the same environment you use to launch Claude Code, then restart; or (2) run `npm run build` in your clone and copy `dist/` into the plugin cache path (fragile). Easiest is (1).

## Installation

### 1. Clone and build the engine

```bash
git clone https://github.com/mtrejodev/tpdc-engine.git
cd tpdc-engine
npm install
npm run build
```

### 2. Add the marketplace to Claude Code

Inside Claude Code, add the **repository directory** (not `marketplace.json`). Using a path that ends in `.json` can break path resolution in Claude Code and produce bogus paths like `tpdc-plugin/tpdc-plugin`.

```
/plugin marketplace add /absolute/path/to/tpdc-engine
```

Or from a Git repo:

```
/plugin marketplace add mtrejodev/tpdc-engine
```

### 3. Install the plugin

```
/plugin install tpdc@tpdc
```

### 4. Verify installation

Run `/tpdc:show` — you should see a list of recent runs (or "No workflow runs found" on first use).

### 5. Reload plugins (if needed)

```
/reload-plugins
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/tpdc:develop` | End-to-end workflow | `/tpdc:develop feature "Implement tenant reset on logout"` |
| `/tpdc:discovery` | Explore a vague idea | `/tpdc:discovery "We need to improve offline reliability"` |
| `/tpdc:assess` | Audit/analysis | `/tpdc:assess "Evaluate security risks in the upload pipeline"` |
| `/tpdc:plan` | Implementation plan | `/tpdc:plan "Port Models Download from Pocket to HQ"` |
| `/tpdc:solve` | Full pipeline | `/tpdc:solve "Add camera permission recovery flow"` |
| `/tpdc:fix` | Bug fix | `/tpdc:fix "Video tiles render as blank gray box on Android"` |
| `/tpdc:refactor` | Structural improvement | `/tpdc:refactor "Split PlantViewModal into smaller components"` |
| `/tpdc:show` | Inspect runs | `/tpdc:show` or `/tpdc:show abc12345` |
| `/tpdc:diff` | View patches | `/tpdc:diff abc12345` |

## Mutation mode

Commands that support mutation (`solve`, `fix`, `refactor`, `develop`) can apply patches to a repository:

```
/tpdc:fix "Camera permission locked on Android" --apply --repo-root ~/my-project
```

The engine will:
1. Generate patches
2. Validate them (dry-run)
3. Show a preview
4. Apply only after confirmation

## Uninstall

Inside Claude Code:

```
/plugin uninstall tpdc@tpdc
```

To also remove the marketplace:

```
/plugin marketplace remove tpdc
```

## Update

```bash
# Pull latest engine code
cd tpdc-engine
git pull
npm install
npm run build
```

Then in Claude Code:

```
/plugin marketplace update tpdc
/reload-plugins
```

## Troubleshooting

### MCP server not starting
- Verify the engine is built: `ls dist/mcp/server.js`
- Check Node.js version: `node --version` (requires 20+)
- Try running the server manually: `node dist/mcp/server.js`

### Commands not appearing
- Run `/reload-plugins`
- Check `/plugin` → Installed tab → verify `tpdc@tpdc` is enabled
- Check `/plugin` → Errors tab for loading issues

### LLM adapter errors
- Default adapter uses Claude Code CLI (`claude --print`)
- For direct API: set `ANTHROPIC_API_KEY` in your environment
- For testing: set `TPDC_ADAPTER=mock`

## Architecture

```
tpdc-engine/
├── src/                    # Engine source
│   ├── runtime/            # Workflow orchestrator + LLM adapters
│   ├── plugin/             # Normalizers, renderers, artifact builders
│   ├── integration/        # Claude integration layer (parser, dispatcher)
│   ├── mcp/                # MCP stdio server
│   ├── learning/           # Self-learning loop
│   └── patch/              # Patch generation, dry-run, apply
├── tpdc-plugin/            # Claude Code plugin package
│   ├── .claude-plugin/     # Plugin manifest
│   ├── .mcp.json           # MCP server registration
│   ├── skills/             # Slash command definitions
│   ├── CLAUDE.md           # Plugin instructions
│   └── README.md           # This file
├── marketplace.json        # Marketplace manifest
├── capabilities/           # Installed TPDC capabilities
├── artifacts/              # Workflow run outputs
└── memory/                 # Learning store
```
