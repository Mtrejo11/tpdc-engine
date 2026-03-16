/**
 * Interactive confirmation with diff preview before apply.
 *
 * Renders a clear, scannable mutation preview and optionally prompts
 * the user to confirm before proceeding.
 */
import { PatchInput, DryRunResult } from "./dryRun";
export interface PreviewData {
    runId: string;
    repoRoot: string;
    patches: PatchInput[];
    dryRunResult: DryRunResult;
    planTitle?: string;
}
export interface ConfirmationResult {
    previewShown: boolean;
    confirmed: boolean;
    /** "interactive" (stdin prompt), "flag" (--confirm-apply), or "declined" */
    source: "interactive" | "flag" | "declined";
}
export declare function renderPreview(data: PreviewData): string;
export declare function promptConfirmation(): Promise<boolean>;
/**
 * Show preview and resolve confirmation.
 *
 * - If `confirmApply` is true (--confirm-apply flag): shows preview, skips prompt, returns confirmed.
 * - If `interactive` is true: shows preview, prompts user, returns their answer.
 * - If neither: shows preview, returns declined.
 */
export declare function confirmWithPreview(data: PreviewData, options: {
    confirmApply: boolean;
    interactive: boolean;
    log: (...args: unknown[]) => void;
}): Promise<ConfirmationResult>;
