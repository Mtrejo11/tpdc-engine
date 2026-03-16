---
name: plan
description: Technical implementation plan with ordered phases, dependencies, and validation approach. No patches. Use when the user asks to "plan", "create a plan", "implementation plan", or "how would we build this".
allowed-tools: mcp__plugin_tpdc_tpdc__tpdc_plan
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-plan

Produce a structured technical implementation plan.

## Arguments

- `request` (required): What to plan

## Workflow

1. Call the `tpdc_plan` MCP tool with the user's request
2. Present the plan: objective, scope, phases with dependencies, files, validation approach, readiness
