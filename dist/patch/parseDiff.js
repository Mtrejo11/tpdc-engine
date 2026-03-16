"use strict";
/**
 * Unified diff parser.
 *
 * Converts unified diff strings from PatchArtifact into structured
 * patch operations that can be validated and later applied.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDiff = parseDiff;
/**
 * Parse a unified diff string into a structured ParsedPatch.
 *
 * Handles standard unified diff format:
 *   --- a/path
 *   +++ b/path
 *   @@ -old,count +new,count @@
 *   context/add/remove lines
 */
function parseDiff(diff) {
    const lines = diff.split("\n");
    // Find --- and +++ headers
    let oldPath = "";
    let newPath = "";
    let headerEnd = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("--- ")) {
            oldPath = stripPathPrefix(lines[i].substring(4));
            headerEnd = i + 1;
        }
        else if (lines[i].startsWith("+++ ")) {
            newPath = stripPathPrefix(lines[i].substring(4));
            headerEnd = i + 1;
            break;
        }
    }
    if (!oldPath && !newPath) {
        return { ok: false, error: { message: "Missing --- and +++ headers" } };
    }
    if (!newPath) {
        return { ok: false, error: { message: "Missing +++ header" } };
    }
    // Parse hunks
    const hunks = [];
    let i = headerEnd;
    while (i < lines.length) {
        // Skip empty lines between hunks
        if (lines[i].trim() === "") {
            i++;
            continue;
        }
        // Expect @@ header
        const hunkHeader = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!hunkHeader) {
            // If we haven't found any hunks yet, this is an error
            if (hunks.length === 0) {
                return {
                    ok: false,
                    error: { message: `Expected @@ hunk header, got: "${lines[i]}"`, line: i + 1 },
                };
            }
            // Otherwise we're past the diff content — stop
            break;
        }
        const oldStart = parseInt(hunkHeader[1], 10);
        const oldCount = hunkHeader[2] !== undefined ? parseInt(hunkHeader[2], 10) : 1;
        const newStart = parseInt(hunkHeader[3], 10);
        const newCount = hunkHeader[4] !== undefined ? parseInt(hunkHeader[4], 10) : 1;
        i++;
        // Collect hunk lines
        const hunkLines = [];
        let removeSeen = 0;
        let addSeen = 0;
        let contextSeen = 0;
        while (i < lines.length) {
            const line = lines[i];
            // Stop at next hunk header or end
            if (line.startsWith("@@ ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
                break;
            }
            if (line.startsWith("-")) {
                hunkLines.push({ type: "remove", content: line.substring(1) });
                removeSeen++;
                i++;
            }
            else if (line.startsWith("+")) {
                hunkLines.push({ type: "add", content: line.substring(1) });
                addSeen++;
                i++;
            }
            else if (line.startsWith(" ") || line === "") {
                // Context line (space-prefixed or empty trailing line)
                hunkLines.push({ type: "context", content: line.startsWith(" ") ? line.substring(1) : "" });
                contextSeen++;
                i++;
            }
            else {
                // Unrecognized line — treat as end of hunk
                break;
            }
            // Stop when we've consumed enough lines for this hunk
            if (removeSeen + contextSeen >= oldCount && addSeen + contextSeen >= newCount) {
                break;
            }
        }
        hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
    }
    if (hunks.length === 0) {
        return { ok: false, error: { message: "No hunks found in diff" } };
    }
    return { ok: true, patch: { oldPath, newPath, hunks } };
}
/**
 * Strip a/ or b/ prefix from diff paths.
 */
function stripPathPrefix(p) {
    if (p.startsWith("a/") || p.startsWith("b/")) {
        return p.substring(2);
    }
    return p;
}
//# sourceMappingURL=parseDiff.js.map