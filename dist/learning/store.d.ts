/**
 * Aggregated lesson store.
 *
 * Maintains a lightweight JSON file of accumulated lessons
 * from past runs. Deduplicates, increments occurrence counts,
 * and keeps the store bounded.
 */
import { LearningArtifact, AggregatedLesson, LessonStore } from "./types";
export declare function loadLessonStore(): LessonStore;
export declare function saveLessonStore(store: LessonStore): void;
/**
 * Merge a new LearningArtifact into the aggregated store.
 * Deduplicates by pattern text, increments occurrence counts,
 * and prunes the store to MAX_LESSONS.
 */
export declare function aggregateLearning(artifact: LearningArtifact): LessonStore;
/**
 * Query relevant lessons for a given command and optional tags.
 * Returns lessons sorted by relevance (matching tags + occurrences).
 */
export declare function queryLessons(command: string, tags?: string[]): AggregatedLesson[];
