/**
 * Memory tool handler — TPDC v0.4.
 *
 * Implements the platform's `memory_20250818` beta tool (client-side
 * dispatch). The model emits tool_use blocks with one of six commands:
 * view / create / str_replace / insert / delete / rename. Each carries
 * a `path` like `/memories/foo.md` which this handler maps to the real
 * filesystem under `<repoRoot>/.tpdc/memory/`.
 *
 * Why per-repo: memory persists across TPDC runs on this repo. Worktrees
 * are ephemeral (removed on push). Each repo's TPDC learnings live next
 * to its `.tpdc/worktrees/` siblings.
 *
 * Safety:
 *   - All paths must resolve INSIDE the memory dir. Symlinks, `..`,
 *     absolute paths outside `/memories/` → rejected.
 *   - Lazy mkdir of the memory dir on first write.
 *   - delete with recursive=true on directories.
 *
 * See VISION.md §4 HIGH (Memory tool) and the Anthropic platform doc
 * "memory tool" for the spec.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Prefix the agent uses for all memory paths. */
const MEMORIES_PREFIX = "/memories";

// ── Input/output types ──────────────────────────────────────────────

export interface MemoryToolInput {
  command: "view" | "create" | "str_replace" | "insert" | "delete" | "rename";
  path?: string;
  old_path?: string;
  new_path?: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  view_range?: [number, number];
}

export interface MemoryToolDeps {
  /** Absolute path to the target repo. Memory lives at `<repoRoot>/.tpdc/memory/`. */
  repoRoot: string;
}

export interface MemoryToolResult {
  content: string;
  isError: boolean;
}

// ── Path resolution + safety ────────────────────────────────────────

function memoryDirOf(repoRoot: string): string {
  return path.resolve(repoRoot, ".tpdc", "memory");
}

/**
 * Map an agent-facing path (e.g. `/memories/foo/bar.md`) to a real filesystem
 * path under `<repoRoot>/.tpdc/memory/`. Rejects anything that resolves outside
 * the memory dir.
 */
export function resolveMemoryPath(
  repoRoot: string,
  agentPath: string,
): { ok: true; absPath: string } | { ok: false; reason: string } {
  if (typeof agentPath !== "string" || agentPath.length === 0) {
    return { ok: false, reason: "path must be a non-empty string" };
  }

  // Strip leading `/memories` (and require it — no implicit paths).
  if (!agentPath.startsWith(MEMORIES_PREFIX)) {
    return {
      ok: false,
      reason: `path must start with '${MEMORIES_PREFIX}' (got '${agentPath}')`,
    };
  }
  let rel = agentPath.slice(MEMORIES_PREFIX.length);
  // Allow exactly '/memories' (the root listing) or '/memories/...'.
  if (rel.length > 0 && !rel.startsWith("/")) {
    return {
      ok: false,
      reason: `path must be '${MEMORIES_PREFIX}' or '${MEMORIES_PREFIX}/...' (got '${agentPath}')`,
    };
  }
  rel = rel.replace(/^\/+/, ""); // strip the leading slash for path.resolve

  const memoryDir = memoryDirOf(repoRoot);
  const candidate = path.resolve(memoryDir, rel);

  // After resolution, candidate MUST be inside memoryDir. This catches
  // ../escape attempts.
  const memoryDirWithSep = memoryDir.endsWith(path.sep) ? memoryDir : memoryDir + path.sep;
  if (candidate !== memoryDir && !candidate.startsWith(memoryDirWithSep)) {
    return {
      ok: false,
      reason: `path resolves outside the memory directory (got '${agentPath}')`,
    };
  }
  return { ok: true, absPath: candidate };
}

async function ensureMemoryDir(repoRoot: string): Promise<void> {
  await fs.mkdir(memoryDirOf(repoRoot), { recursive: true });
}

// ── Command handlers ────────────────────────────────────────────────

async function handleView(
  absPath: string,
  viewRange?: [number, number],
): Promise<MemoryToolResult> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: `Error: '${absPath}' does not exist.`, isError: true };
    }
    throw err;
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    if (entries.length === 0) {
      return { content: "(empty directory)", isError: false };
    }
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return { content: lines.join("\n"), isError: false };
  }

  const raw = await fs.readFile(absPath, "utf-8");
  if (!viewRange) return { content: raw, isError: false };

  const [start, end] = viewRange;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return {
      content: `Error: view_range must be [start, end] with 1-indexed integers and start <= end.`,
      isError: true,
    };
  }
  const lines = raw.split("\n");
  const sliced = lines.slice(start - 1, end);
  return { content: sliced.join("\n"), isError: false };
}

async function handleCreate(
  absPath: string,
  fileText: string,
): Promise<MemoryToolResult> {
  if (typeof fileText !== "string") {
    return { content: "Error: file_text is required.", isError: true };
  }
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, fileText, "utf-8");
  return { content: `Created ${absPath}.`, isError: false };
}

async function handleStrReplace(
  absPath: string,
  oldStr: string,
  newStr: string,
): Promise<MemoryToolResult> {
  if (typeof oldStr !== "string" || typeof newStr !== "string") {
    return { content: "Error: old_str and new_str are required.", isError: true };
  }
  let original: string;
  try {
    original = await fs.readFile(absPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: `Error: '${absPath}' does not exist.`, isError: true };
    }
    throw err;
  }
  const occurrences = original.split(oldStr).length - 1;
  if (occurrences === 0) {
    return { content: `Error: old_str not found in file.`, isError: true };
  }
  if (occurrences > 1) {
    return {
      content: `Error: old_str matches ${occurrences} times. Provide more context for a unique match.`,
      isError: true,
    };
  }
  await fs.writeFile(absPath, original.replace(oldStr, newStr), "utf-8");
  return { content: `Replaced 1 occurrence in ${absPath}.`, isError: false };
}

async function handleInsert(
  absPath: string,
  insertLine: number,
  insertText: string,
): Promise<MemoryToolResult> {
  if (!Number.isInteger(insertLine) || insertLine < 0) {
    return { content: "Error: insert_line must be a non-negative integer.", isError: true };
  }
  if (typeof insertText !== "string") {
    return { content: "Error: insert_text is required.", isError: true };
  }
  let original: string;
  try {
    original = await fs.readFile(absPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: `Error: '${absPath}' does not exist.`, isError: true };
    }
    throw err;
  }
  const lines = original.split("\n");
  if (insertLine > lines.length) {
    return {
      content: `Error: insert_line ${insertLine} exceeds file length (${lines.length}).`,
      isError: true,
    };
  }
  lines.splice(insertLine, 0, insertText);
  await fs.writeFile(absPath, lines.join("\n"), "utf-8");
  return { content: `Inserted at line ${insertLine} of ${absPath}.`, isError: false };
}

async function handleDelete(absPath: string): Promise<MemoryToolResult> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: `Error: '${absPath}' does not exist.`, isError: true };
    }
    throw err;
  }
  if (stat.isDirectory()) {
    await fs.rm(absPath, { recursive: true, force: true });
    return { content: `Deleted directory ${absPath}.`, isError: false };
  }
  await fs.unlink(absPath);
  return { content: `Deleted ${absPath}.`, isError: false };
}

async function handleRename(
  oldAbs: string,
  newAbs: string,
): Promise<MemoryToolResult> {
  try {
    await fs.stat(oldAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: `Error: '${oldAbs}' does not exist.`, isError: true };
    }
    throw err;
  }
  await fs.mkdir(path.dirname(newAbs), { recursive: true });
  await fs.rename(oldAbs, newAbs);
  return { content: `Renamed ${oldAbs} → ${newAbs}.`, isError: false };
}

// ── Public handler ──────────────────────────────────────────────────

/**
 * Dispatch a memory tool command.
 *
 * Returns ToolHandlerResult-shaped: { content: string, isError: boolean }.
 * The execute loop converts this to a tool_result block for the next turn.
 */
export async function runMemoryTool(
  input: MemoryToolInput,
  deps: MemoryToolDeps,
): Promise<MemoryToolResult> {
  // Lazy-create the memory dir so the agent's first `view /memories` doesn't
  // ENOENT on a fresh repo.
  await ensureMemoryDir(deps.repoRoot);

  switch (input.command) {
    case "view": {
      const r = resolveMemoryPath(deps.repoRoot, input.path ?? "");
      if (!r.ok) return { content: `Error: ${r.reason}`, isError: true };
      return handleView(r.absPath, input.view_range);
    }
    case "create": {
      const r = resolveMemoryPath(deps.repoRoot, input.path ?? "");
      if (!r.ok) return { content: `Error: ${r.reason}`, isError: true };
      return handleCreate(r.absPath, input.file_text ?? "");
    }
    case "str_replace": {
      const r = resolveMemoryPath(deps.repoRoot, input.path ?? "");
      if (!r.ok) return { content: `Error: ${r.reason}`, isError: true };
      return handleStrReplace(r.absPath, input.old_str ?? "", input.new_str ?? "");
    }
    case "insert": {
      const r = resolveMemoryPath(deps.repoRoot, input.path ?? "");
      if (!r.ok) return { content: `Error: ${r.reason}`, isError: true };
      return handleInsert(
        r.absPath,
        input.insert_line ?? 0,
        input.insert_text ?? "",
      );
    }
    case "delete": {
      const r = resolveMemoryPath(deps.repoRoot, input.path ?? "");
      if (!r.ok) return { content: `Error: ${r.reason}`, isError: true };
      return handleDelete(r.absPath);
    }
    case "rename": {
      const oldR = resolveMemoryPath(deps.repoRoot, input.old_path ?? "");
      if (!oldR.ok) return { content: `Error: ${oldR.reason}`, isError: true };
      const newR = resolveMemoryPath(deps.repoRoot, input.new_path ?? "");
      if (!newR.ok) return { content: `Error: ${newR.reason}`, isError: true };
      return handleRename(oldR.absPath, newR.absPath);
    }
    default: {
      const cmd = String((input as { command?: unknown }).command);
      return {
        content: `Error: unknown memory command '${cmd}'. Expected one of view, create, str_replace, insert, delete, rename.`,
        isError: true,
      };
    }
  }
}
