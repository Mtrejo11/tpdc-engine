/**
 * Tests for the recordRunEvent helper.
 *
 * Real mkdtemp + fs ops — no mocks. Each test isolates its own temp
 * "repoRoot" and inspects the resulting markdown file directly.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  recordRunEvent,
  renderEventSection,
  type ExecuteCompleteEvent,
  type TestsCompleteEvent,
  type PROpenedEvent,
  type CICompleteEvent,
  type HaltEvent,
} from "./record-event.js";

const executeEvent: ExecuteCompleteEvent = {
  eventType: "execute_complete",
  task: "Add sorting options for product list",
  status: "completed",
  branch: "tpdc/add-sorting-abc123",
  filesChanged: ["src/components/Sort.tsx", "src/styles.css"],
  finalSummary: "Added a sort dropdown above the grid.",
  toolCallCount: 14,
  turnCount: 8,
};

const testsEvent: TestsCompleteEvent = {
  eventType: "tests_complete",
  status: "all_passed",
  commands: [
    { command: "npm test", passed: true },
    { command: "npm run typecheck", passed: true },
  ],
};

const prEvent: PROpenedEvent = {
  eventType: "pr_opened",
  prUrl: "https://github.com/foo/bar/pull/42",
  prNumber: 42,
  draft: false,
};

const ciEvent: CICompleteEvent = {
  eventType: "ci_complete",
  conclusion: "success",
  localFixRetries: 0,
  ciFixRetries: 0,
};

const haltEvent: HaltEvent = {
  eventType: "halt",
  stage: "execute",
  reason: "Plan referenced a missing module",
};

describe("recordRunEvent", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpdc-rec-"));
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("creates the runs/ directory + summary file with header on first event", async () => {
    const result = await recordRunEvent({
      runId: "ship-001",
      repoRoot,
      event: executeEvent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.path).toBe(
      path.join(repoRoot, ".tpdc", "memory", "runs", "ship-001.md"),
    );

    const body = await fs.readFile(result.path, "utf-8");
    expect(body).toMatch(/^# TPDC run ship-001\n/);
    expect(body).toContain("## Execute");
    expect(body).toContain("Add sorting options for product list");
    expect(body).toContain("`tpdc/add-sorting-abc123`");
  });

  it("appends subsequent events as new sections without rewriting the header", async () => {
    await recordRunEvent({ runId: "r-2", repoRoot, event: executeEvent });
    await recordRunEvent({ runId: "r-2", repoRoot, event: testsEvent });
    await recordRunEvent({ runId: "r-2", repoRoot, event: prEvent });
    const ci = await recordRunEvent({ runId: "r-2", repoRoot, event: ciEvent });
    expect(ci.ok).toBe(true);
    if (!ci.ok) return;
    expect(ci.created).toBe(false); // file existed by now

    const body = await fs.readFile(ci.path, "utf-8");
    // Header once; sections in order.
    const headers = body.match(/^# TPDC run/gm) ?? [];
    expect(headers.length).toBe(1);

    const sectionOrder = body
      .split("\n")
      .filter((l) => l.startsWith("## "))
      .map((l) => l.replace(/^## /, ""));
    expect(sectionOrder).toEqual(["Execute", "Tests", "PR", "CI"]);
  });

  it("does NOT dedupe — duplicate events from a buggy caller produce two sections", async () => {
    await recordRunEvent({ runId: "r-3", repoRoot, event: ciEvent });
    const second = await recordRunEvent({ runId: "r-3", repoRoot, event: ciEvent });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const body = await fs.readFile(second.path, "utf-8");
    const ciSections = body.match(/^## CI$/gm) ?? [];
    expect(ciSections.length).toBe(2);
  });

  it("handles execute_complete with empty filesChanged (no_changes status)", async () => {
    const result = await recordRunEvent({
      runId: "r-4",
      repoRoot,
      event: {
        ...executeEvent,
        status: "no_changes",
        filesChanged: [],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = await fs.readFile(result.path, "utf-8");
    expect(body).toContain("**Status:** no_changes");
    expect(body).toContain("_(none — `no_changes` status)_");
  });

  it("records a halt event with stage + reason", async () => {
    const result = await recordRunEvent({ runId: "r-5", repoRoot, event: haltEvent });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = await fs.readFile(result.path, "utf-8");
    expect(body).toContain("## Halt");
    expect(body).toContain("**Stage:** execute");
    expect(body).toContain("**Reason:** Plan referenced a missing module");
  });

  it("rejects an empty runId", async () => {
    const result = await recordRunEvent({ runId: "", repoRoot, event: ciEvent });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/runId/);
  });

  it("rejects an empty repoRoot", async () => {
    const result = await recordRunEvent({ runId: "r", repoRoot: "", event: ciEvent });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/repoRoot/);
  });

  it("truncates very long finalSummary to keep file greppable", async () => {
    const huge = "x".repeat(5000);
    const result = await recordRunEvent({
      runId: "r-long",
      repoRoot,
      event: { ...executeEvent, finalSummary: huge },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = await fs.readFile(result.path, "utf-8");
    expect(body).toContain("…");
    expect(body).toContain("*(truncated;");
    expect(body.length).toBeLessThan(huge.length);
  });

  it("includes optional wipReason and draft in PR section when set", async () => {
    const result = await recordRunEvent({
      runId: "r-wip",
      repoRoot,
      event: { ...prEvent, draft: true, wipReason: "Local tests failing after 3 retries" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = await fs.readFile(result.path, "utf-8");
    expect(body).toContain("**Draft:** true");
    expect(body).toContain("**WIP reason:** Local tests failing after 3 retries");
  });
});

describe("renderEventSection (pure renderer)", () => {
  it("renders tests_complete with per-command pass/fail glyphs", () => {
    const out = renderEventSection(testsEvent);
    expect(out).toContain("✓ `npm test`");
    expect(out).toContain("✓ `npm run typecheck`");
  });

  it("renders tests_complete without commands list when no_commands", () => {
    const out = renderEventSection({
      eventType: "tests_complete",
      status: "no_commands",
      commands: [],
    });
    expect(out).toContain("**Status:** no_commands");
    expect(out).not.toContain("### Commands");
  });

  it("renders ci_complete without optional retries when undefined", () => {
    const out = renderEventSection({
      eventType: "ci_complete",
      conclusion: "failure",
    });
    expect(out).toContain("**Conclusion:** failure");
    expect(out).not.toContain("Local fix retries");
  });

  it("renders execute_complete with file count in header", () => {
    const out = renderEventSection(executeEvent);
    expect(out).toContain("### Files changed (2)");
  });
});
