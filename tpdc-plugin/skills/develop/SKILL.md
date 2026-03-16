---
name: develop
description: End-to-end development workflow. Orchestrates discovery → plan → solve (feature), fix (bug), or refactor. Use when the user asks to "develop a feature", "develop a fix", "develop a refactor", "end-to-end development", or "full dev cycle".
allowed-tools: Read, Grep, Glob, mcp__plugin_tpdc_tpdc__tpdc_develop, mcp__plugin_tpdc_tpdc__tpdc_show, mcp__plugin_tpdc_tpdc__tpdc_diff
metadata:
  author: tpdc
  version: "0.1"
---

# /tpdc-develop

End-to-end development workflow using the TPDC engine.

## Purpose

Orchestrate a complete development cycle for a feature, bug fix, or refactor.

## Arguments

- `mode` (required): One of `feature`, `bug`, or `refactor`
- `request` (required): Description of what to develop

## Usage

The user must explicitly specify the mode:

```
/tpdc-develop feature "Implement tenant reset on logout in Field Lite"
/tpdc-develop bug "Camera permission locked after denial on Android"
/tpdc-develop refactor "Split PlantViewModal into smaller components"
```

## Workflow

1. Parse the mode and request from the user's input
2. Call the `tpdc_develop` MCP tool with the mode and request
3. If the user wants to apply patches, also pass `repo_root`, `apply: true`, and `confirm_apply: true`
4. Present the output to the user
5. If the flow was blocked, explain what's missing and how to provide it

## Stopping rules

- If discovery is not ready → stop and show why
- If plan is blocked → stop and show blockers
- If fix is blocked → stop and show missing bug context
- If user declines confirmation → summarize without mutation

## Notes

- This command orchestrates existing TPDC capabilities. Do NOT duplicate logic.
- For mutation mode, always ask the user for the repo path before calling with `apply: true`.
