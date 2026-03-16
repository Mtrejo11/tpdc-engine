/**
 * Learning artifact types.
 */

export interface LearningArtifact {
  runId: string;
  command: string;
  mode: string;
  outcome: string;
  lessons: string[];
  failurePatterns: string[];
  successPatterns: string[];
  suggestedHeuristics: string[];
  tags: string[];
  timestamp: string;
}

export interface AggregatedLesson {
  pattern: string;
  source: "block" | "failure" | "success" | "heuristic";
  occurrences: number;
  lastSeen: string;
  commands: string[];
  tags: string[];
}

export interface LessonStore {
  version: number;
  lastUpdated: string;
  lessons: AggregatedLesson[];
}
