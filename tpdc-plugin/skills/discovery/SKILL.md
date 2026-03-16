---
name: discovery
description: Frame a vague idea before execution. Produces problem framing, tradeoffs, readiness assessment, and a suggested next command. Use when the user has a vague idea and wants to explore it, "discover", "frame the problem", or "explore this idea".
allowed-tools: mcp__plugin_tpdc_tpdc__tpdc_discovery
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-discovery

Frame and analyze a vague idea before committing to execution.

## Arguments

- `request` (required): The idea or concept to explore

## Workflow

1. Call the `tpdc_discovery` MCP tool with the user's request
2. Present the discovery output: problem framing, tradeoffs, readiness, suggested next command
3. If readiness is `needs_input`, highlight the critical questions
4. If readiness is `ready_for_execution`, suggest the next command to run
