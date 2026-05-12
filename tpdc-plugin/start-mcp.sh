#!/bin/bash
# TPDC MCP server launcher — resolves engine root (monorepo) vs Claude plugin cache (often tpdc-plugin only).
# Claude expands ${CLAUDE_PLUGIN_ROOT} in .mcp.json; use TPDC_ENGINE_ROOT when dist/ lives outside the cache.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${TPDC_ENGINE_ROOT:-}" ] && [ -f "${TPDC_ENGINE_ROOT}/dist/mcp/server.js" ]; then
  ENGINE_ROOT="$TPDC_ENGINE_ROOT"
else
  ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [ ! -d "$ENGINE_ROOT/node_modules" ]; then
  (cd "$ENGINE_ROOT" && npm install --production --silent 2>/dev/null) || true
fi

if [ ! -f "$ENGINE_ROOT/dist/mcp/server.js" ]; then
  echo "tpdc start-mcp: missing $ENGINE_ROOT/dist/mcp/server.js" >&2
  echo "  Fix: cd your tpdc-engine clone && npm install && npm run build" >&2
  echo "  If the plugin cache only has tpdc-plugin/ (no dist/), export TPDC_ENGINE_ROOT to that clone before starting Claude Code, e.g.:" >&2
  echo "    export TPDC_ENGINE_ROOT=$HOME/Documents/Personal/tpdc-engine" >&2
  exit 1
fi

# Anthropic SDK reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from the process env.
# Claude Code does not inject your subscription into MCP child processes — load a key here
# (never commit keys into .mcp.json in git).
for envfile in "${HOME}/.config/tpdc/env" "${ENGINE_ROOT}/.env"; do
  if [ -f "$envfile" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$envfile"
    set +a
  fi
done

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "tpdc start-mcp: set ANTHROPIC_API_KEY for tpdc_execute / team-meeting. Example: mkdir -p ~/.config/tpdc && echo 'ANTHROPIC_API_KEY=sk-ant-...' >> ~/.config/tpdc/env && chmod 600 ~/.config/tpdc/env" >&2
fi

exec node "$ENGINE_ROOT/dist/mcp/server.js"
