---
name: fix
description: Bug-fix flow with normalization. Extracts platform, component, and behavior from bug reports. Supports mutation mode. Use when the user reports a bug, asks to "fix a bug", "debug", or describes broken behavior.
allowed-tools: Read, Grep, Glob, mcp__plugin_tpdc_tpdc__tpdc_fix, mcp__plugin_tpdc_tpdc__tpdc_show, mcp__plugin_tpdc_tpdc__tpdc_diff
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-fix

Bug-fix flow with input normalization and missing-context detection.

## Arguments

- `request` (required): Bug description
- For mutation mode, the user must provide a repo path

## Workflow

1. Call the `tpdc_fix` MCP tool with the bug description
2. If blocked due to missing context, present the suggested clarified bug report
3. For mutation mode, pass `repo_root`, `apply: true`, `confirm_apply: true`
4. Present the result with validation checklist
