#!/bin/bash
# TPDC MCP server launcher — resolves engine root from this script (tpdc-plugin/ → repo root).
# Avoids hardcoding ~/.claude/... so marketplace copies and dev checkouts both work.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$ENGINE_ROOT/node_modules" ]; then
  (cd "$ENGINE_ROOT" && npm install --production --silent 2>/dev/null) || true
fi

if [ ! -f "$ENGINE_ROOT/dist/mcp/server.js" ]; then
  echo "tpdc start-mcp: missing $ENGINE_ROOT/dist/mcp/server.js — run: cd \"$ENGINE_ROOT\" && npm install && npm run build" >&2
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
