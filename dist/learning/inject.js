"use strict";
/**
 * Lesson injection into workflow requests.
 *
 * Loads relevant prior lessons and prepends them as context hints
 * to the request text before it enters the workflow pipeline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectLessons = injectLessons;
const store_1 = require("./store");
/**
 * Augment a request string with relevant prior lessons.
 * Returns the original request with a prepended context section
 * if relevant lessons are found.
 */
function injectLessons(request, command, tags = []) {
    const lessons = (0, store_1.queryLessons)(command, tags);
    if (lessons.length === 0)
        return request;
    // Select the most impactful lessons
    const heuristics = lessons.filter((l) => l.source === "heuristic").slice(0, 3);
    const blocks = lessons.filter((l) => l.source === "block").slice(0, 2);
    const failures = lessons.filter((l) => l.source === "failure").slice(0, 2);
    const hints = [];
    if (heuristics.length > 0) {
        hints.push("Prior learnings (from past runs):");
        for (const h of heuristics) {
            hints.push(`- ${h.pattern} (seen ${h.occurrences}x)`);
        }
    }
    if (blocks.length > 0) {
        hints.push("Common blocking patterns to avoid:");
        for (const b of blocks) {
            hints.push(`- ${formatBlockLesson(b)}`);
        }
    }
    if (failures.length > 0) {
        hints.push("Known failure patterns:");
        for (const f of failures) {
            hints.push(`- ${f.pattern} (seen ${f.occurrences}x)`);
        }
    }
    if (hints.length === 0)
        return request;
    return [
        "---",
        "Context from prior TPDC runs:",
        ...hints,
        "---",
        "",
        request,
    ].join("\n");
}
function formatBlockLesson(lesson) {
    // Shorten block patterns for the context section
    const pattern = lesson.pattern
        .replace(/^Blocked:\s*/i, "")
        .replace(/^Decompose blocked:\s*/i, "");
    return pattern.length > 100
        ? pattern.substring(0, 97) + "..."
        : pattern;
}
//# sourceMappingURL=inject.js.map