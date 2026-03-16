---
name: diff
description: Show patch diffs for a mutation run. Use when the user asks to "show diff", "show patches", "what changed in run", or "see the changes".
allowed-tools: mcp__tpdc__tpdc_diff
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-diff

Show color-coded patch diffs for a mutation run.

## Arguments

- `run_id` (required): Workflow run ID

## Workflow

1. Call `tpdc_diff` MCP tool with the run ID
2. Present the diff: files changed, dry-run status, apply result, color-coded patches
