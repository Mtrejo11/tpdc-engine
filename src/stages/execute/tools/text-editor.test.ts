import { describe, expect, it, vi } from "vitest";
import { runTextEditorTool } from "./text-editor.js";

function makeFsMock(initial: Record<string, string> = {}): {
  fs: NonNullable<Parameters<typeof runTextEditorTool>[1]["fsImpl"]>;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    fs: {
      readFile: vi.fn(async (p: string) => {
        if (!files.has(p)) {
          const err: NodeJS.ErrnoException = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        return files.get(p) ?? "";
      }) as unknown as typeof import("node:fs/promises").readFile,
      writeFile: vi.fn(async (p: string, data: string) => {
        files.set(p, data);
      }) as unknown as typeof import("node:fs/promises").writeFile,
      mkdir: vi.fn(async () => undefined) as unknown as typeof import("node:fs/promises").mkdir,
      stat: vi.fn(async (p: string) => {
        if (!files.has(p)) {
          const err: NodeJS.ErrnoException = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        return { isDirectory: () => false, isFile: () => true } as Awaited<
          ReturnType<typeof import("node:fs/promises").stat>
        >;
      }) as unknown as typeof import("node:fs/promises").stat,
      readdir: vi.fn(async () => []) as unknown as typeof import("node:fs/promises").readdir,
    },
  };
}

describe("runTextEditorTool", () => {
  describe("path traversal guard", () => {
    it("rejects paths that escape the worktree", async () => {
      const { fs } = makeFsMock();
      const result = await runTextEditorTool(
        { command: "view", path: "../etc/passwd" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/escapes the worktree/i);
    });

    it("accepts paths inside the worktree", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/foo.txt": "hello" });
      const result = await runTextEditorTool(
        { command: "view", path: "foo.txt" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(false);
      expect(result.content).toContain("hello");
    });
  });

  describe("view command", () => {
    it("returns numbered lines for a file", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/a.ts": "line1\nline2\nline3" });
      const result = await runTextEditorTool(
        { command: "view", path: "a.ts" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(false);
      expect(result.content).toContain("1: line1");
      expect(result.content).toContain("3: line3");
    });

    it("respects view_range", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/a.ts": "a\nb\nc\nd\ne" });
      const result = await runTextEditorTool(
        { command: "view", path: "a.ts", view_range: [2, 4] },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.content).toContain("2: b");
      expect(result.content).toContain("4: d");
      expect(result.content).not.toContain("1: a");
      expect(result.content).not.toContain("5: e");
    });

    it("errors on non-existent path", async () => {
      const { fs } = makeFsMock();
      const result = await runTextEditorTool(
        { command: "view", path: "missing.ts" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/does not exist/i);
    });
  });

  describe("create command", () => {
    it("writes new file", async () => {
      const { fs, files } = makeFsMock();
      const result = await runTextEditorTool(
        { command: "create", path: "new.ts", file_text: "export const X = 1;" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(false);
      expect(files.get("/tmp/wt/new.ts")).toBe("export const X = 1;");
    });

    it("refuses if file exists", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/exists.ts": "old" });
      const result = await runTextEditorTool(
        { command: "create", path: "exists.ts", file_text: "new" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/already exists/i);
    });
  });

  describe("str_replace command", () => {
    it("replaces a unique occurrence", async () => {
      const { fs, files } = makeFsMock({
        "/tmp/wt/a.ts": "const x = 1;\nconst y = 2;\n",
      });
      const result = await runTextEditorTool(
        { command: "str_replace", path: "a.ts", old_str: "const x = 1;", new_str: "const x = 42;" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(false);
      expect(files.get("/tmp/wt/a.ts")).toBe("const x = 42;\nconst y = 2;\n");
    });

    it("errors when old_str matches multiple times", async () => {
      const { fs } = makeFsMock({
        "/tmp/wt/a.ts": "x\nx\nx",
      });
      const result = await runTextEditorTool(
        { command: "str_replace", path: "a.ts", old_str: "x", new_str: "y" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/3 times/i);
    });

    it("errors when old_str not found", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/a.ts": "no match here" });
      const result = await runTextEditorTool(
        { command: "str_replace", path: "a.ts", old_str: "missing", new_str: "x" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/not found/i);
    });

    it("rejects empty old_str", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/a.ts": "content" });
      const result = await runTextEditorTool(
        { command: "str_replace", path: "a.ts", old_str: "", new_str: "x" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
    });
  });

  describe("insert command", () => {
    it("inserts at given line", async () => {
      const { fs, files } = makeFsMock({ "/tmp/wt/a.ts": "line1\nline2\nline3" });
      const result = await runTextEditorTool(
        { command: "insert", path: "a.ts", insert_line: 1, new_str: "INSERTED" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(false);
      expect(files.get("/tmp/wt/a.ts")).toBe("line1\nINSERTED\nline2\nline3");
    });

    it("rejects out-of-bounds insert_line", async () => {
      const { fs } = makeFsMock({ "/tmp/wt/a.ts": "only" });
      const result = await runTextEditorTool(
        { command: "insert", path: "a.ts", insert_line: 999, new_str: "X" },
        { worktreePath: "/tmp/wt", fsImpl: fs },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/beyond file end/i);
    });
  });

  it("rejects unknown commands", async () => {
    const { fs } = makeFsMock();
    const result = await runTextEditorTool(
      { command: "exotic" as unknown as "view", path: "x" },
      { worktreePath: "/tmp/wt", fsImpl: fs },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/unsupported/i);
  });
});
