/**
 * Text editor tool handler — TPDC v2.
 *
 * Implements the contract for Anthropic's `text_editor_20250728` tool
 * (model-facing name: `str_replace_based_edit_tool`). Operates on files
 * inside a worktree. Path traversal is rejected — paths must resolve
 * inside the worktree.
 *
 * Commands supported in v2 alpha:
 *   - view: read a file (or list a directory)
 *   - create: write a new file
 *   - str_replace: replace exact substring
 *   - insert: insert lines at a 1-indexed line number
 *
 * Skipped (TODO): undo_edit (requires history tracking)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export type TextEditorCommand = "view" | "create" | "str_replace" | "insert";

export interface TextEditorToolInput {
  command: TextEditorCommand | string;
  path: string;
  // For create
  file_text?: string;
  // For str_replace
  old_str?: string;
  new_str?: string;
  // For view
  view_range?: [number, number];
  // For insert
  insert_line?: number;
}

export interface TextEditorToolDeps {
  worktreePath: string;
  fsImpl?: Pick<typeof fs, "readFile" | "writeFile" | "mkdir" | "stat" | "readdir">;
}

export interface TextEditorToolResult {
  content: string;
  isError: boolean;
}

export async function runTextEditorTool(
  input: TextEditorToolInput,
  deps: TextEditorToolDeps,
): Promise<TextEditorToolResult> {
  const fsImpl = deps.fsImpl ?? fs;

  if (typeof input.path !== "string" || input.path.length === 0) {
    return { content: "Error: text_editor requires a `path`.", isError: true };
  }

  const wtRoot = path.resolve(deps.worktreePath);
  const absPath = path.resolve(wtRoot, input.path);

  // Path traversal guard: resolved path must be inside the worktree.
  if (absPath !== wtRoot && !absPath.startsWith(wtRoot + path.sep)) {
    return {
      content: `Error: path "${input.path}" escapes the worktree (${wtRoot}).`,
      isError: true,
    };
  }

  switch (input.command) {
    case "view":
      return viewCommand(absPath, input.view_range, fsImpl);
    case "create":
      return createCommand(absPath, input.file_text ?? "", fsImpl);
    case "str_replace":
      return strReplaceCommand(absPath, input.old_str ?? "", input.new_str ?? "", fsImpl);
    case "insert":
      return insertCommand(absPath, input.insert_line, input.new_str ?? "", fsImpl);
    default:
      return {
        content: `Error: unsupported command "${input.command}". Supported: view, create, str_replace, insert.`,
        isError: true,
      };
  }
}

async function viewCommand(
  absPath: string,
  viewRange: [number, number] | undefined,
  fsImpl: NonNullable<TextEditorToolDeps["fsImpl"]>,
): Promise<TextEditorToolResult> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fsImpl.stat(absPath);
  } catch {
    return { content: `Error: ${absPath} does not exist.`, isError: true };
  }

  if (stat.isDirectory()) {
    const entries = await fsImpl.readdir(absPath);
    const sorted = [...entries].sort();
    return {
      content:
        `Directory ${absPath}:\n` + sorted.map((e) => `  ${e}`).join("\n"),
      isError: false,
    };
  }

  const raw = await fsImpl.readFile(absPath, "utf-8");
  const lines = (raw as string).split("\n");
  const numbered = lines.map((line, i) => `${i + 1}: ${line}`);

  if (viewRange) {
    const [start, end] = viewRange;
    const safeStart = Math.max(1, start);
    const safeEnd = end === -1 ? numbered.length : Math.min(numbered.length, end);
    return {
      content: numbered.slice(safeStart - 1, safeEnd).join("\n"),
      isError: false,
    };
  }

  return { content: numbered.join("\n"), isError: false };
}

async function createCommand(
  absPath: string,
  fileText: string,
  fsImpl: NonNullable<TextEditorToolDeps["fsImpl"]>,
): Promise<TextEditorToolResult> {
  // Refuse if file already exists — model should use str_replace for edits
  try {
    await fsImpl.stat(absPath);
    return {
      content: `Error: ${absPath} already exists. Use str_replace to modify it.`,
      isError: true,
    };
  } catch {
    // ENOENT — proceed
  }

  await fsImpl.mkdir(path.dirname(absPath), { recursive: true });
  await fsImpl.writeFile(absPath, fileText, "utf-8");
  return { content: `Created ${absPath}`, isError: false };
}

async function strReplaceCommand(
  absPath: string,
  oldStr: string,
  newStr: string,
  fsImpl: NonNullable<TextEditorToolDeps["fsImpl"]>,
): Promise<TextEditorToolResult> {
  if (oldStr.length === 0) {
    return {
      content: `Error: str_replace requires a non-empty old_str.`,
      isError: true,
    };
  }

  let raw: string;
  try {
    raw = (await fsImpl.readFile(absPath, "utf-8")) as string;
  } catch {
    return { content: `Error: ${absPath} does not exist.`, isError: true };
  }

  const occurrences = countOccurrences(raw, oldStr);
  if (occurrences === 0) {
    return {
      content: `Error: old_str not found in ${absPath}.`,
      isError: true,
    };
  }
  if (occurrences > 1) {
    return {
      content: `Error: old_str matches ${occurrences} times in ${absPath}; provide a more specific snippet.`,
      isError: true,
    };
  }

  const replaced = raw.replace(oldStr, newStr);
  await fsImpl.writeFile(absPath, replaced, "utf-8");
  return { content: `Replaced 1 occurrence in ${absPath}.`, isError: false };
}

async function insertCommand(
  absPath: string,
  insertLine: number | undefined,
  newStr: string,
  fsImpl: NonNullable<TextEditorToolDeps["fsImpl"]>,
): Promise<TextEditorToolResult> {
  if (typeof insertLine !== "number" || insertLine < 0) {
    return {
      content: `Error: insert requires a non-negative insert_line (1-indexed; 0 inserts at top).`,
      isError: true,
    };
  }

  let raw: string;
  try {
    raw = (await fsImpl.readFile(absPath, "utf-8")) as string;
  } catch {
    return { content: `Error: ${absPath} does not exist.`, isError: true };
  }

  const lines = raw.split("\n");
  if (insertLine > lines.length) {
    return {
      content: `Error: insert_line ${insertLine} beyond file end (${lines.length} lines).`,
      isError: true,
    };
  }

  const inserted = [...lines.slice(0, insertLine), newStr, ...lines.slice(insertLine)];
  await fsImpl.writeFile(absPath, inserted.join("\n"), "utf-8");
  return { content: `Inserted at line ${insertLine} in ${absPath}.`, isError: false };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while ((from = haystack.indexOf(needle, from)) !== -1) {
    count++;
    from += needle.length;
  }
  return count;
}
