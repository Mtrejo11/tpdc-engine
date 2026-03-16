---
name: refactor
description: Structural improvement without changing functional behavior. Detects extraction, decomposition, consolidation, simplification, or architecture patterns. Supports mutation mode. Use when the user asks to "refactor", "restructure", "extract", "split component", "consolidate", or "clean up code".
allowed-tools: mcp__plugin_tpdc_tpdc__tpdc_refactor, mcp__plugin_tpdc_tpdc__tpdc_show, mcp__plugin_tpdc_tpdc__tpdc_diff
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-refactor

Structural improvement with risk assessment and behavior preservation.

## Arguments

- `request` (required): Refactor request
- For mutation mode, the user must provide a repo path

## Workflow

1. Call the `tpdc_refactor` MCP tool with the request
2. Present the refactor plan: targets, risk level, strategy, affected files, expected benefits
3. For mutation mode, pass `repo_root`, `apply: true`, `confirm_apply: true`
