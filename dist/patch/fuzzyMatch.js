"use strict";
/**
 * Conservative fuzzy hunk relocation.
 *
 * When a diff hunk's absolute line number is wrong but the surrounding
 * context lines match real file content elsewhere, this module locates
 * the correct position. It is intentionally strict:
 *
 *  - All context + remove lines must match consecutively.
 *  - Only ONE candidate position is accepted. Multiple matches → ambiguous → reject.
 *  - Search window is bounded (default ±500 lines from the hunk's claimed position).
 *  - Trailing whitespace tolerance mirrors the existing dry-run behavior.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.relocateHunks = relocateHunks;
// ── Core ─────────────────────────────────────────────────────────────
/**
 * Extract the "fingerprint" of a hunk: the ordered sequence of lines
 * that must appear in the original file (context + remove lines).
 */
function extractFingerprint(hunk) {
    return hunk.lines
        .filter((l) => l.type === "context" || l.type === "remove")
        .map((l) => l.content);
}
/**
 * Check whether a fingerprint matches at a given 0-based start index
 * in the file, with trailing-whitespace tolerance.
 */
function matchesAt(fileLines, startIdx, fingerprint) {
    if (startIdx < 0 || startIdx + fingerprint.length > fileLines.length) {
        return false;
    }
    for (let i = 0; i < fingerprint.length; i++) {
        const actual = fileLines[startIdx + i];
        const expected = fingerprint[i];
        if (actual !== expected && actual.trimEnd() !== expected.trimEnd()) {
            return false;
        }
    }
    return true;
}
/**
 * Relocate all hunks in a parsed diff against actual file contents.
 *
 * For each hunk:
 * 1. Try the exact line number first.
 * 2. If that fails, search outward from the claimed position within the radius.
 * 3. Require exactly one match — zero or multiple means failure.
 *
 * Returns relocated positions for ALL hunks, or a descriptive failure.
 */
function relocateHunks(hunks, fileLines, options = {}) {
    // When no explicit radius is set, search the entire file. This is safe
    // because we require exactly one unambiguous match.
    const explicitRadius = options.maxSearchRadius;
    const relocations = [];
    for (let h = 0; h < hunks.length; h++) {
        const hunk = hunks[h];
        const fingerprint = extractFingerprint(hunk);
        // Empty fingerprint (pure additions) — accept at face value
        if (fingerprint.length === 0) {
            relocations.push({
                hunkIndex: h,
                originalStart: hunk.oldStart,
                relocatedStart: hunk.oldStart,
                offset: 0,
                confidence: "exact",
            });
            continue;
        }
        const claimedIdx = hunk.oldStart - 1; // 0-based
        // 1. Try exact position first
        if (matchesAt(fileLines, claimedIdx, fingerprint)) {
            relocations.push({
                hunkIndex: h,
                originalStart: hunk.oldStart,
                relocatedStart: hunk.oldStart,
                offset: 0,
                confidence: "exact",
            });
            continue;
        }
        // 2. Fuzzy search: scan for the fingerprint
        //    With explicit radius: restrict to ±radius around claimed position.
        //    Without: search the entire file (safe because we require exactly 1 match).
        const lastPossible = fileLines.length - fingerprint.length;
        const searchStart = explicitRadius != null
            ? Math.max(0, claimedIdx - explicitRadius)
            : 0;
        const searchEnd = explicitRadius != null
            ? Math.min(lastPossible, claimedIdx + explicitRadius)
            : lastPossible;
        const candidates = []; // 0-based indices where fingerprint matches
        for (let idx = searchStart; idx <= searchEnd; idx++) {
            if (idx === claimedIdx)
                continue; // Already checked
            if (matchesAt(fileLines, idx, fingerprint)) {
                candidates.push(idx);
            }
        }
        if (candidates.length === 0) {
            const rangeDesc = explicitRadius != null
                ? `within ±${explicitRadius} lines of line ${hunk.oldStart}`
                : `in file (${fileLines.length} lines)`;
            return {
                ok: false,
                detail: `Hunk ${h + 1}: no match found ${rangeDesc}. ` +
                    `First context line: "${truncate(fingerprint[0], 60)}"`,
            };
        }
        if (candidates.length > 1) {
            return {
                ok: false,
                detail: `Hunk ${h + 1}: ambiguous — ${candidates.length} candidate matches found near line ${hunk.oldStart}. ` +
                    `Positions: ${candidates.map((c) => c + 1).join(", ")}. ` +
                    `Refusing fuzzy match to avoid incorrect application.`,
            };
        }
        // Exactly one candidate — safe to relocate
        const relocatedIdx = candidates[0];
        relocations.push({
            hunkIndex: h,
            originalStart: hunk.oldStart,
            relocatedStart: relocatedIdx + 1, // back to 1-based
            offset: relocatedIdx + 1 - hunk.oldStart,
            confidence: "fuzzy",
        });
    }
    return { ok: true, relocations };
}
function truncate(s, max) {
    return s.length > max ? s.substring(0, max - 3) + "..." : s;
}
//# sourceMappingURL=fuzzyMatch.js.map