---
name: solve
description: Run the full TPDC pipeline for a request. Supports mutation mode with apply. Use when the user asks to "solve", "run the pipeline", "execute this", or wants the full intake → design → decompose → execute → validate flow.
allowed-tools: mcp__tpdc__tpdc_solve, mcp__tpdc__tpdc_show, mcp__tpdc__tpdc_diff
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-solve

Run the full TPDC engine pipeline.

## Arguments

- `request` (required): The request to solve
- For mutation mode, the user must provide a repo path

## Workflow

1. Call the `tpdc_solve` MCP tool with the request
2. For mutation mode, pass `repo_root`, `apply: true`, `confirm_apply: true`
3. Present the workflow summary
4. If mutation was applied, show the branch name and files changed
