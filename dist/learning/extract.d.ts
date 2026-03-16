/**
 * Lesson extraction from completed workflow runs.
 *
 * Derives reusable lessons from:
 * - blocked runs (missing context patterns)
 * - validate findings (repeated issues)
 * - dry-run failures (patch problems)
 * - mutation outcomes (apply patterns)
 * - successful executions (what worked)
 */
import { RunSummary } from "../storage/runs";
import { LearningArtifact } from "./types";
export declare function extractLearnings(run: RunSummary, command: string): LearningArtifact;
