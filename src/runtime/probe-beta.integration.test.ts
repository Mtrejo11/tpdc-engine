/**
 * Beta-capability probe — integration test (hits the real Anthropic API).
 *
 * Skipped when ANTHROPIC_API_KEY is not set, so default `npm test` is free.
 * Set the env var to verify the current platform's acceptance of each
 * capability TPDC depends on (or is considering depending on).
 *
 * Each probe is intentionally a tiny 1-turn request — the goal is to
 * detect SDK-ahead-of-API divergences (the alpha.4 + alpha.10 lessons)
 * before they break a real dogfood run.
 *
 * Add a new probe here as the FIRST step of adopting any new beta. If the
 * probe rejects, that's a hard signal to defer adoption.
 */

import { describe, expect, it } from "vitest";

import { probeBetaConfig } from "./probe-beta.js";

const skipIfNoApi = !process.env.ANTHROPIC_API_KEY;
const PROBE_TIMEOUT_MS = 60_000;

describe.skipIf(skipIfNoApi)("beta capability probes (real API)", () => {
  it(
    "advisor tool beta is accepted on Opus 4.7 (regression — already used in execute)",
    async () => {
      const result = await probeBetaConfig({
        model: "claude-opus-4-7",
        betas: ["advisor-tool-2026-03-01"],
        tools: [
          {
            type: "advisor_20260301",
            name: "advisor",
            model: "claude-opus-4-7",
          } as unknown as never,
        ],
      });
      expect(result.ok).toBe(true);
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    "adaptive thinking + output_config.effort is accepted on Opus 4.7",
    async () => {
      const result = await probeBetaConfig({
        model: "claude-opus-4-7",
        thinking: { type: "adaptive" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        // Surface the rejection reason in the test output so we can see it
        // without re-running.
        // eslint-disable-next-line no-console
        console.error("Thinking probe rejection:", result.error, "status:", result.status);
      }
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    "compact_20260112 context_management is STILL rejected (regression detector)",
    async () => {
      // When this test starts FAILING (probe ok:true), the API has caught
      // up to SDK types — at that point, re-enable context_management in
      // execute.ts per the alpha.10 hotfix notes and remove this test.
      const result = await probeBetaConfig({
        model: "claude-sonnet-4-6",
        betas: ["context-management-2025-06-27"],
        contextManagement: {
          edits: [
            {
              type: "compact_20260112",
              trigger: { type: "input_tokens", value: 120000 },
              pause_after_compaction: false,
            },
          ],
        },
      });
      // Document the regression: as of 2026-05-12 the API rejects this.
      // The test asserts that rejection persists; flip when re-enabled.
      expect(result.ok).toBe(false);
    },
    PROBE_TIMEOUT_MS,
  );

  it(
    "clear_tool_uses_20250919 context_management IS accepted (alpha.10 fallback)",
    async () => {
      // If compact_20260112 ever needs a stopgap, this is the supported
      // alternative — drops older tool inputs at trigger. Documenting that
      // it works so the alpha.10 hotfix comment isn't misleading.
      const result = await probeBetaConfig({
        model: "claude-sonnet-4-6",
        betas: ["context-management-2025-06-27"],
        contextManagement: {
          edits: [
            {
              type: "clear_tool_uses_20250919",
              trigger: { type: "input_tokens", value: 100000 },
              clear_tool_inputs: true,
              exclude_tools: ["memory"],
            },
          ],
        },
      });
      expect(result.ok).toBe(true);
    },
    PROBE_TIMEOUT_MS,
  );
});
