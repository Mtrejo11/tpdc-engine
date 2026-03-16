/**
 * Lesson injection into workflow requests.
 *
 * Loads relevant prior lessons and prepends them as context hints
 * to the request text before it enters the workflow pipeline.
 */
/**
 * Augment a request string with relevant prior lessons.
 * Returns the original request with a prepended context section
 * if relevant lessons are found.
 */
export declare function injectLessons(request: string, command: string, tags?: string[]): string;
