#!/bin/bash
# TPDC MCP server launcher — auto-installs dependencies if needed
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/tpdc"

if [ ! -d "$MARKETPLACE_DIR/node_modules" ]; then
  cd "$MARKETPLACE_DIR" && npm install --production --silent 2>/dev/null
fi

exec node "$MARKETPLACE_DIR/dist/mcp/server.js"
