---
name: show
description: Inspect a TPDC workflow run. Without arguments, lists recent runs. Use when the user asks to "show run", "inspect run", "list runs", or "what runs do we have".
allowed-tools: mcp__plugin_tpdc_tpdc__tpdc_show
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-show

Inspect workflow runs.

## Arguments

- `run_id` (optional): Workflow run ID or partial match. Omit to list recent runs.

## Workflow

1. Call `tpdc_show` MCP tool
2. Without args: show recent run list
3. With run_id: show full run details (stages, findings, mutation details)
