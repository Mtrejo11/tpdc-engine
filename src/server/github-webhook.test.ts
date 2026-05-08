import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractRunIdFromBranch,
  parseCheckSuitePayload,
  verifyGitHubSignature,
} from "./github-webhook.js";

describe("extractRunIdFromBranch", () => {
  it("extracts runId from a tpdc/run-<id> branch", () => {
    expect(extractRunIdFromBranch("tpdc/run-abc123")).toBe("abc123");
    expect(extractRunIdFromBranch("tpdc/run-smoke-pr-001")).toBe("smoke-pr-001");
  });

  it("returns null for non-tpdc branches", () => {
    expect(extractRunIdFromBranch("main")).toBeNull();
    expect(extractRunIdFromBranch("feature/foo")).toBeNull();
    expect(extractRunIdFromBranch("tpdc/something-else")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractRunIdFromBranch(null)).toBeNull();
    expect(extractRunIdFromBranch(undefined)).toBeNull();
    expect(extractRunIdFromBranch("")).toBeNull();
  });
});

describe("verifyGitHubSignature", () => {
  const secret = "supersecret";
  const body = '{"hello":"world"}';
  const validSig =
    "sha256=" + createHmac("sha256", secret).update(body, "utf-8").digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyGitHubSignature(body, validSig, secret)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    const wrong = "sha256=" + "0".repeat(64);
    expect(verifyGitHubSignature(body, wrong, secret)).toBe(false);
  });

  it("rejects when body has been tampered", () => {
    const tampered = body + " ";
    expect(verifyGitHubSignature(tampered, validSig, secret)).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyGitHubSignature(body, null, secret)).toBe(false);
    expect(verifyGitHubSignature(body, "", secret)).toBe(false);
    expect(verifyGitHubSignature(body, "md5=abc", secret)).toBe(false);
  });

  it("rejects when secret is empty", () => {
    expect(verifyGitHubSignature(body, validSig, "")).toBe(false);
  });

  it("rejects signatures of mismatched length", () => {
    expect(verifyGitHubSignature(body, "sha256=abcd", secret)).toBe(false);
  });
});

describe("parseCheckSuitePayload", () => {
  function makePayload(overrides: {
    action?: string;
    branch?: string | null;
    conclusion?: string | null;
    prNumber?: number | null;
    htmlUrl?: string;
  } = {}) {
    return {
      action: overrides.action ?? "completed",
      check_suite: {
        head_branch: overrides.branch ?? "tpdc/run-r-1",
        conclusion: overrides.conclusion ?? "success",
        status: "completed",
        pull_requests: overrides.prNumber !== null ? [{ number: overrides.prNumber ?? 42 }] : [],
        html_url: overrides.htmlUrl ?? "https://github.com/acme/app/runs/123",
      },
    };
  }

  it("emits success event for a successful tpdc check_suite", () => {
    const result = parseCheckSuitePayload(makePayload({ conclusion: "success" }));
    expect(result.kind).toBe("emit");
    if (result.kind === "emit") {
      expect(result.event.name).toBe("tpdc/ci.completed");
      expect(result.event.data.runId).toBe("r-1");
      expect(result.event.data.status).toBe("success");
      expect(result.event.data.prNumber).toBe(42);
      expect(result.event.data.logsUrl).toBe("https://github.com/acme/app/runs/123");
    }
  });

  it("emits failure event for a failed check_suite", () => {
    const result = parseCheckSuitePayload(makePayload({ conclusion: "failure" }));
    expect(result.kind).toBe("emit");
    if (result.kind === "emit") {
      expect(result.event.data.status).toBe("failure");
    }
  });

  it("emits cancelled event for a cancelled check_suite", () => {
    const result = parseCheckSuitePayload(makePayload({ conclusion: "cancelled" }));
    expect(result.kind).toBe("emit");
    if (result.kind === "emit") {
      expect(result.event.data.status).toBe("cancelled");
    }
  });

  it("treats timed_out and action_required as failure", () => {
    for (const c of ["timed_out", "action_required"]) {
      const result = parseCheckSuitePayload(makePayload({ conclusion: c }));
      expect(result.kind).toBe("emit");
      if (result.kind === "emit") {
        expect(result.event.data.status).toBe("failure");
      }
    }
  });

  it("ignores non-completed actions", () => {
    const result = parseCheckSuitePayload(makePayload({ action: "requested" }));
    expect(result.kind).toBe("ignored");
    if (result.kind === "ignored") {
      expect(result.reason).toMatch(/action=requested/);
    }
  });

  it("ignores branches that don't match tpdc/run-*", () => {
    const result = parseCheckSuitePayload(makePayload({ branch: "main" }));
    expect(result.kind).toBe("ignored");
    if (result.kind === "ignored") {
      expect(result.reason).toMatch(/not a TPDC branch/i);
    }
  });

  it("ignores neutral/skipped conclusions", () => {
    for (const c of ["neutral", "skipped", "stale"]) {
      const result = parseCheckSuitePayload(makePayload({ conclusion: c }));
      expect(result.kind).toBe("ignored");
      if (result.kind === "ignored") {
        expect(result.reason).toMatch(/not actionable/i);
      }
    }
  });

  it("ignores when no PR is associated", () => {
    const result = parseCheckSuitePayload(makePayload({ prNumber: null }));
    expect(result.kind).toBe("ignored");
    if (result.kind === "ignored") {
      expect(result.reason).toMatch(/no associated PR/i);
    }
  });

  it("ignores when check_suite is missing", () => {
    const result = parseCheckSuitePayload({ action: "completed" });
    expect(result.kind).toBe("ignored");
  });

  it("includes failedJobs as empty array (populated later by resolve-ci)", () => {
    const result = parseCheckSuitePayload(makePayload({ conclusion: "failure" }));
    expect(result.kind).toBe("emit");
    if (result.kind === "emit") {
      expect(result.event.data.failedJobs).toEqual([]);
    }
  });
});
