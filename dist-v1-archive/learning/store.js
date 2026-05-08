"use strict";
/**
 * Aggregated lesson store.
 *
 * Maintains a lightweight JSON file of accumulated lessons
 * from past runs. Deduplicates, increments occurrence counts,
 * and keeps the store bounded.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadLessonStore = loadLessonStore;
exports.saveLessonStore = saveLessonStore;
exports.aggregateLearning = aggregateLearning;
exports.queryLessons = queryLessons;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MEMORY_DIR = path.resolve(__dirname, "../../memory");
const STORE_PATH = path.join(MEMORY_DIR, "lessons.json");
const MAX_LESSONS = 100;
function loadLessonStore() {
    if (!fs.existsSync(STORE_PATH)) {
        return { version: 1, lastUpdated: new Date().toISOString(), lessons: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    }
    catch {
        return { version: 1, lastUpdated: new Date().toISOString(), lessons: [] };
    }
}
function saveLessonStore(store) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}
/**
 * Merge a new LearningArtifact into the aggregated store.
 * Deduplicates by pattern text, increments occurrence counts,
 * and prunes the store to MAX_LESSONS.
 */
function aggregateLearning(artifact) {
    const store = loadLessonStore();
    // Index existing lessons by pattern for fast lookup
    const index = new Map();
    for (const lesson of store.lessons) {
        index.set(lesson.pattern, lesson);
    }
    // Merge failure patterns
    for (const pattern of artifact.failurePatterns) {
        mergePattern(index, pattern, "failure", artifact);
    }
    // Merge success patterns
    for (const pattern of artifact.successPatterns) {
        mergePattern(index, pattern, "success", artifact);
    }
    // Merge heuristics
    for (const h of artifact.suggestedHeuristics) {
        mergePattern(index, h, "heuristic", artifact);
    }
    // Merge block-derived lessons
    for (const lesson of artifact.lessons) {
        if (lesson.startsWith("Blocked:") || lesson.startsWith("Decompose blocked:")) {
            mergePattern(index, lesson, "block", artifact);
        }
    }
    // Rebuild lessons array, sorted by recency then occurrences
    const lessons = Array.from(index.values())
        .sort((a, b) => {
        // Most recent first, then most frequent
        const timeA = new Date(a.lastSeen).getTime();
        const timeB = new Date(b.lastSeen).getTime();
        if (timeB !== timeA)
            return timeB - timeA;
        return b.occurrences - a.occurrences;
    })
        .slice(0, MAX_LESSONS);
    store.lessons = lessons;
    store.lastUpdated = new Date().toISOString();
    saveLessonStore(store);
    return store;
}
function mergePattern(index, pattern, source, artifact) {
    const existing = index.get(pattern);
    if (existing) {
        existing.occurrences += 1;
        existing.lastSeen = artifact.timestamp;
        // Merge commands and tags
        if (!existing.commands.includes(artifact.command)) {
            existing.commands.push(artifact.command);
        }
        for (const tag of artifact.tags) {
            if (!existing.tags.includes(tag)) {
                existing.tags.push(tag);
            }
        }
    }
    else {
        index.set(pattern, {
            pattern,
            source,
            occurrences: 1,
            lastSeen: artifact.timestamp,
            commands: [artifact.command],
            tags: [...artifact.tags],
        });
    }
}
/**
 * Query relevant lessons for a given command and optional tags.
 * Returns lessons sorted by relevance (matching tags + occurrences).
 */
function queryLessons(command, tags = []) {
    const store = loadLessonStore();
    // Score each lesson by relevance
    const scored = store.lessons.map((lesson) => {
        let score = 0;
        // Command match
        if (lesson.commands.includes(command))
            score += 3;
        // Tag overlap
        for (const tag of tags) {
            if (lesson.tags.includes(tag))
                score += 2;
        }
        // Frequency bonus
        if (lesson.occurrences >= 3)
            score += 2;
        else if (lesson.occurrences >= 2)
            score += 1;
        // Heuristics are always useful
        if (lesson.source === "heuristic")
            score += 1;
        return { lesson, score };
    });
    return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.lesson)
        .slice(0, 10);
}
//# sourceMappingURL=store.js.map