/**
 * Tests for waitCI. Mock execFile + sleep + now so we can simulate long
 * polling sequences in microseconds.
 */

import { describe, expect, it, vi } from "vitest";

import { waitCI, type WaitCIDeps, type WaitCIRequest } from "./wait-ci.js";

const baseReq: WaitCIRequest = {
  runId: "r-1",
  repoRoot: "/tmp/repo",
  branch: "tpdc/run-r-1",
  initialDelayMs: 0,
  pollIntervalMs: 10,
  maxPollIntervalMs: 100,
  maxWaitMs: 1000,
};

interface GhCall {
  stdout: string;
}

function ghOk(runs: unknown[]): GhCall {
  return { stdout: JSON.stringify(runs) };
}

interface MockState {
  exec: number;
  slept: number;
  now: number;
}

function makeDeps(ghResponses: Array<GhCall | Error>): {
  deps: WaitCIDeps;
  state: MockState;
} {
  const state: MockState = { exec: 0, slept: 0, now: 0 };
  const deps: WaitCIDeps = {
    // biome-ignore lint/suspicious/noExplicitAny: typed mock
    execFileImpl: vi.fn(async (..._args: any[]) => {
      const next = ghResponses[state.exec];
      state.exec++;
      if (!next) {
        throw new Error(`no more gh responses queued (call #${state.exec})`);
      }
      if (next instanceof Error) throw next;
      return { stdout: next.stdout, stderr: "" } as unknown as { stdout: string; stderr: string };
    }) as unknown as WaitCIDeps["execFileImpl"],
    sleep: vi.fn(async (ms: number) => {
      state.slept++;
      state.now += ms;
    }),
    now: () => state.now,
  };
  return { deps, state };
}

const inProgress = {
  databaseId: 999,
  status: "in_progress",
  conclusion: null,
  workflowName: "CI",
  url: "https://github.com/owner/repo/actions/runs/999",
  headSha: "abc",
  headBranch: "tpdc/run-r-1",
};
const successRun = { ...inProgress, status: "completed", conclusion: "success" };
const failureRun = { ...inProgress, status: "completed", conclusion: "failure" };

describe("waitCI — happy paths", () => {
  it("returns completed/success on the first poll", async () => {
    const { deps } = makeDeps([ghOk([successRun])]);
    const result = await waitCI(baseReq, deps);

    expect(result.status).toBe("completed");
    expect(result.conclusion).toBe("success");
    expect(result.workflowRunId).toBe(999);
    expect(result.url).toBe("https://github.com/owner/repo/actions/runs/999");
    expect(result.workflowName).toBe("CI");
    expect(result.sawAnyRun).toBe(true);
    expect(result.pollCount).toBe(1);
  });

  it("returns completed/failure when CI is red", async () => {
    const { deps } = makeDeps([ghOk([failureRun])]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("completed");
    expect(result.conclusion).toBe("failure");
  });

  it("polls past in_progress until completed", async () => {
    const { deps, state } = makeDeps([
      ghOk([inProgress]),
      ghOk([inProgress]),
      ghOk([successRun]),
    ]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("completed");
    expect(result.pollCount).toBe(3);
    expect(state.slept).toBeGreaterThanOrEqual(2); // 2 between polls
  });

  it("backs off the poll interval each iteration", async () => {
    const { deps } = makeDeps([
      ghOk([inProgress]),
      ghOk([inProgress]),
      ghOk([inProgress]),
      ghOk([successRun]),
    ]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("completed");
    // 3 sleeps with backoff 10, 15, 22
    expect(result.durationMs).toBeGreaterThanOrEqual(30);
  });
});

describe("waitCI — headSha filtering", () => {
  it("ignores runs whose headSha does not match when headSha is specified", async () => {
    const otherRun = { ...successRun, headSha: "other-sha" };
    const desired = { ...successRun, headSha: "deadbeef" };
    const { deps } = makeDeps([
      ghOk([otherRun]),
      ghOk([otherRun, desired]),
    ]);
    const result = await waitCI({ ...baseReq, headSha: "deadbeef" }, deps);
    expect(result.status).toBe("completed");
    expect(result.workflowRunId).toBe(999);
    expect(result.pollCount).toBe(2);
  });

  it("considers headSha-matched run regardless of position in list", async () => {
    const fresh = { ...successRun, databaseId: 1, headSha: "newer", workflowName: "Other" };
    const target = { ...successRun, databaseId: 2, headSha: "deadbeef" };
    const { deps } = makeDeps([ghOk([fresh, target])]);
    const result = await waitCI({ ...baseReq, headSha: "deadbeef" }, deps);
    expect(result.workflowRunId).toBe(2);
  });
});

describe("waitCI — no runs found", () => {
  it("keeps polling when entries is empty (race with workflow dispatch)", async () => {
    const { deps } = makeDeps([
      ghOk([]),
      ghOk([]),
      ghOk([successRun]),
    ]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("completed");
    expect(result.pollCount).toBe(3);
  });

  it("returns timeout with sawAnyRun=false if no run ever appears", async () => {
    const empties: GhCall[] = Array.from({ length: 30 }, () => ghOk([]));
    const { deps } = makeDeps(empties);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("timeout");
    expect(result.sawAnyRun).toBe(false);
  });
});

describe("waitCI — error handling", () => {
  it("absorbs transient gh failures and retries", async () => {
    const { deps } = makeDeps([
      new Error("network blip"),
      ghOk([successRun]),
    ]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("completed");
    expect(result.pollCount).toBe(2);
  });

  it("returns errored status after 3 consecutive gh failures", async () => {
    const { deps } = makeDeps([
      new Error("gh missing"),
      new Error("gh missing"),
      new Error("gh missing"),
    ]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("errored");
    expect(result.lastErrorMessage).toMatch(/gh missing/);
    expect(result.pollCount).toBe(3);
  });

  it("resets the error counter after a successful poll between failures", async () => {
    const { deps } = makeDeps([
      new Error("blip"),
      ghOk([inProgress]),
      new Error("blip"),
      ghOk([successRun]),
    ]);
    const result = await waitCI(baseReq, deps);
    expect(result.status).toBe("completed");
  });
});

describe("waitCI — config plumbing", () => {
  it("respects initialDelayMs before the first poll", async () => {
    const { deps, state } = makeDeps([ghOk([successRun])]);
    await waitCI({ ...baseReq, initialDelayMs: 250 }, deps);
    expect(state.slept).toBeGreaterThanOrEqual(1);
    expect(state.now).toBeGreaterThanOrEqual(250);
  });

  it("respects maxPollIntervalMs (backoff cap)", async () => {
    const calls: GhCall[] = Array.from({ length: 8 }, () => ghOk([inProgress]));
    calls.push(ghOk([successRun]));
    const { deps, state } = makeDeps(calls);
    await waitCI({ ...baseReq, maxWaitMs: 5_000 }, deps);
    expect(state.now).toBeLessThan(5_000);
  });
});
