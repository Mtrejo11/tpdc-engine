/**
 * Tests for the memory tool handler.
 *
 * Real filesystem ops in a mkdtemp dir. The handler is a thin layer over
 * fs/promises so unit-testing against the real filesystem is faster and
 * more accurate than mocking every fs call.
 *
 * Path safety is exhaustively tested — any escape from `/memories/`
 * (../, absolute, missing prefix) must be rejected.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveMemoryPath,
  runMemoryTool,
  type MemoryToolDeps,
} from "./memory.js";

let repoRoot: string;
let memoryDir: string;
let deps: MemoryToolDeps;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpdc-memory-test-"));
  memoryDir = path.resolve(repoRoot, ".tpdc", "memory");
  deps = { repoRoot };
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

// ── Path resolution + safety ────────────────────────────────────────

describe("resolveMemoryPath", () => {
  it("maps /memories/foo.md to <repoRoot>/.tpdc/memory/foo.md", () => {
    const r = resolveMemoryPath(repoRoot, "/memories/foo.md");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absPath).toBe(path.join(memoryDir, "foo.md"));
    }
  });

  it("accepts nested paths", () => {
    const r = resolveMemoryPath(repoRoot, "/memories/runs/r-1.md");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absPath).toBe(path.join(memoryDir, "runs", "r-1.md"));
    }
  });

  it("accepts the bare /memories root (for view)", () => {
    const r = resolveMemoryPath(repoRoot, "/memories");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absPath).toBe(memoryDir);
    }
  });

  it("rejects paths without the /memories prefix", () => {
    const r = resolveMemoryPath(repoRoot, "/etc/passwd");
    expect(r.ok).toBe(false);
  });

  it("rejects paths with a malformed prefix (no slash after /memories)", () => {
    const r = resolveMemoryPath(repoRoot, "/memoriesfoo.md");
    expect(r.ok).toBe(false);
  });

  it("rejects ../ escapes", () => {
    const r = resolveMemoryPath(repoRoot, "/memories/../../etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/outside the memory directory/);
    }
  });

  it("rejects nested .. traversal that resolves inside still — wait, that should be OK", () => {
    // Sanity: /memories/foo/../bar.md → /memories/bar.md, still inside
    const r = resolveMemoryPath(repoRoot, "/memories/foo/../bar.md");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absPath).toBe(path.join(memoryDir, "bar.md"));
    }
  });

  it("rejects empty path", () => {
    const r = resolveMemoryPath(repoRoot, "");
    expect(r.ok).toBe(false);
  });
});

// ── Command: create + view ──────────────────────────────────────────

describe("runMemoryTool — create + view", () => {
  it("creates a file and reads it back", async () => {
    const created = await runMemoryTool(
      { command: "create", path: "/memories/notes.md", file_text: "hello" },
      deps,
    );
    expect(created.isError).toBe(false);

    const viewed = await runMemoryTool(
      { command: "view", path: "/memories/notes.md" },
      deps,
    );
    expect(viewed.isError).toBe(false);
    expect(viewed.content).toBe("hello");
  });

  it("creates intermediate directories on demand", async () => {
    const created = await runMemoryTool(
      {
        command: "create",
        path: "/memories/runs/2026/r-1.md",
        file_text: "run data",
      },
      deps,
    );
    expect(created.isError).toBe(false);
    const exists = await fs
      .stat(path.join(memoryDir, "runs", "2026", "r-1.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("view of /memories on fresh repo returns empty dir (lazy mkdir)", async () => {
    const viewed = await runMemoryTool({ command: "view", path: "/memories" }, deps);
    expect(viewed.isError).toBe(false);
    expect(viewed.content).toBe("(empty directory)");
  });

  it("view lists directory entries sorted, with trailing slash for dirs", async () => {
    await runMemoryTool(
      { command: "create", path: "/memories/zeta.md", file_text: "" },
      deps,
    );
    await runMemoryTool(
      { command: "create", path: "/memories/alpha.md", file_text: "" },
      deps,
    );
    await fs.mkdir(path.join(memoryDir, "subdir"), { recursive: true });

    const viewed = await runMemoryTool({ command: "view", path: "/memories" }, deps);
    expect(viewed.isError).toBe(false);
    expect(viewed.content).toBe("alpha.md\nsubdir/\nzeta.md");
  });

  it("view with view_range slices 1-indexed inclusive", async () => {
    await runMemoryTool(
      {
        command: "create",
        path: "/memories/multi.md",
        file_text: "line1\nline2\nline3\nline4",
      },
      deps,
    );
    const viewed = await runMemoryTool(
      { command: "view", path: "/memories/multi.md", view_range: [2, 3] },
      deps,
    );
    expect(viewed.content).toBe("line2\nline3");
  });

  it("view of non-existent file returns error", async () => {
    const r = await runMemoryTool(
      { command: "view", path: "/memories/missing.md" },
      deps,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/does not exist/);
  });
});

// ── Command: str_replace ────────────────────────────────────────────

describe("runMemoryTool — str_replace", () => {
  beforeEach(async () => {
    await runMemoryTool(
      {
        command: "create",
        path: "/memories/sr.md",
        file_text: "hello world\nfoo bar",
      },
      deps,
    );
  });

  it("replaces a unique match", async () => {
    const r = await runMemoryTool(
      {
        command: "str_replace",
        path: "/memories/sr.md",
        old_str: "world",
        new_str: "everyone",
      },
      deps,
    );
    expect(r.isError).toBe(false);
    const viewed = await runMemoryTool(
      { command: "view", path: "/memories/sr.md" },
      deps,
    );
    expect(viewed.content).toBe("hello everyone\nfoo bar");
  });

  it("rejects when old_str not found", async () => {
    const r = await runMemoryTool(
      {
        command: "str_replace",
        path: "/memories/sr.md",
        old_str: "not present",
        new_str: "x",
      },
      deps,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/);
  });

  it("rejects when old_str matches multiple times", async () => {
    await runMemoryTool(
      {
        command: "create",
        path: "/memories/multi.md",
        file_text: "x\nx\nx",
      },
      deps,
    );
    const r = await runMemoryTool(
      {
        command: "str_replace",
        path: "/memories/multi.md",
        old_str: "x",
        new_str: "y",
      },
      deps,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/matches 3 times/);
  });
});

// ── Command: insert ─────────────────────────────────────────────────

describe("runMemoryTool — insert", () => {
  beforeEach(async () => {
    await runMemoryTool(
      {
        command: "create",
        path: "/memories/i.md",
        file_text: "line1\nline2\nline3",
      },
      deps,
    );
  });

  it("inserts at line 0 (start)", async () => {
    const r = await runMemoryTool(
      {
        command: "insert",
        path: "/memories/i.md",
        insert_line: 0,
        insert_text: "new-first",
      },
      deps,
    );
    expect(r.isError).toBe(false);
    const viewed = await runMemoryTool(
      { command: "view", path: "/memories/i.md" },
      deps,
    );
    expect(viewed.content).toBe("new-first\nline1\nline2\nline3");
  });

  it("inserts at line 2 (between lines)", async () => {
    await runMemoryTool(
      {
        command: "insert",
        path: "/memories/i.md",
        insert_line: 2,
        insert_text: "inserted",
      },
      deps,
    );
    const viewed = await runMemoryTool(
      { command: "view", path: "/memories/i.md" },
      deps,
    );
    expect(viewed.content).toBe("line1\nline2\ninserted\nline3");
  });

  it("rejects insert_line beyond file length", async () => {
    const r = await runMemoryTool(
      {
        command: "insert",
        path: "/memories/i.md",
        insert_line: 999,
        insert_text: "x",
      },
      deps,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/exceeds file length/);
  });
});

// ── Command: delete + rename ────────────────────────────────────────

describe("runMemoryTool — delete", () => {
  it("deletes a file", async () => {
    await runMemoryTool(
      { command: "create", path: "/memories/d.md", file_text: "x" },
      deps,
    );
    const r = await runMemoryTool(
      { command: "delete", path: "/memories/d.md" },
      deps,
    );
    expect(r.isError).toBe(false);
    const exists = await fs
      .stat(path.join(memoryDir, "d.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("deletes a directory recursively", async () => {
    await runMemoryTool(
      {
        command: "create",
        path: "/memories/d/nested.md",
        file_text: "x",
      },
      deps,
    );
    const r = await runMemoryTool(
      { command: "delete", path: "/memories/d" },
      deps,
    );
    expect(r.isError).toBe(false);
  });

  it("returns error for non-existent path", async () => {
    const r = await runMemoryTool(
      { command: "delete", path: "/memories/nope.md" },
      deps,
    );
    expect(r.isError).toBe(true);
  });
});

describe("runMemoryTool — rename", () => {
  it("renames a file", async () => {
    await runMemoryTool(
      { command: "create", path: "/memories/from.md", file_text: "x" },
      deps,
    );
    const r = await runMemoryTool(
      {
        command: "rename",
        old_path: "/memories/from.md",
        new_path: "/memories/to.md",
      },
      deps,
    );
    expect(r.isError).toBe(false);
    const fromExists = await fs
      .stat(path.join(memoryDir, "from.md"))
      .then(() => true)
      .catch(() => false);
    const toExists = await fs
      .stat(path.join(memoryDir, "to.md"))
      .then(() => true)
      .catch(() => false);
    expect(fromExists).toBe(false);
    expect(toExists).toBe(true);
  });

  it("rejects rename of non-existent source", async () => {
    const r = await runMemoryTool(
      {
        command: "rename",
        old_path: "/memories/missing.md",
        new_path: "/memories/x.md",
      },
      deps,
    );
    expect(r.isError).toBe(true);
  });

  it("rejects rename when target path is outside memory dir", async () => {
    await runMemoryTool(
      { command: "create", path: "/memories/x.md", file_text: "x" },
      deps,
    );
    const r = await runMemoryTool(
      {
        command: "rename",
        old_path: "/memories/x.md",
        new_path: "/etc/x.md",
      },
      deps,
    );
    expect(r.isError).toBe(true);
  });
});

describe("runMemoryTool — unknown command", () => {
  it("returns error for unknown command", async () => {
    const r = await runMemoryTool(
      // biome-ignore lint/suspicious/noExplicitAny: testing invariant
      { command: "yolo" as any },
      deps,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/unknown memory command/);
  });
});
