---
name: assess
description: Analysis/audit mode. Evaluates security, performance, or architecture risks without producing patches. Use when the user asks to "assess", "audit", "evaluate security", "check performance", "review architecture", or "analyze risks".
allowed-tools: Read, Grep, Glob, mcp__plugin_tpdc_tpdc__tpdc_assess
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-assess

Analyze and evaluate code, architecture, or risks without producing patches.

## Arguments

- `request` (required): The analysis request

## Workflow

1. Call the `tpdc_assess` MCP tool with the user's request
2. Present the assessment: scope, findings by risk level, recommended actions
