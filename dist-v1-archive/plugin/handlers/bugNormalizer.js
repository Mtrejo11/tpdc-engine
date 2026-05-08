"use strict";
/**
 * Bug report normalizer.
 *
 * Extracts structured bug context from free-text descriptions
 * before passing to the workflow. Does NOT invent missing data —
 * preserves gaps so the workflow blocks correctly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBugReport = normalizeBugReport;
exports.suggestClarifiedReport = suggestClarifiedReport;
/**
 * Parse a free-text bug description into structured context.
 * Extraction is best-effort using keyword/pattern matching.
 * Missing fields are tracked but never fabricated.
 */
function normalizeBugReport(raw) {
    const extracted = {};
    const missingFields = [];
    // Platform detection
    const platformPatterns = [
        [/\bandroid\b/i, "Android"],
        [/\bios\b/i, "iOS"],
        [/\biphone\b/i, "iOS"],
        [/\bipad\b/i, "iOS"],
        [/\breact[ -]?native\b/i, "React Native (iOS + Android)"],
        [/\bexpo\b/i, "Expo (React Native)"],
        [/\bweb\b/i, "Web"],
        [/\bdesktop\b/i, "Desktop"],
        [/\belectron\b/i, "Electron (Desktop)"],
    ];
    for (const [pattern, platform] of platformPatterns) {
        if (pattern.test(raw)) {
            extracted.platform = platform;
            break;
        }
    }
    if (!extracted.platform)
        missingFields.push("platform");
    // Screen / component detection
    const screenMatch = raw.match(/(?:in|on|at|within|inside|from)\s+(?:the\s+)?([A-Z][A-Za-z]*(?:Screen|Modal|View|Page|Component|Tab|Dialog|Picker|Menu|Bar|Panel|Form|List))/) || raw.match(/([A-Z][A-Za-z]*(?:Screen|Modal|View|Page|Component))/);
    if (screenMatch) {
        extracted.screen = screenMatch[1];
    }
    else {
        // Try quoted or backtick-wrapped identifiers
        const backtickMatch = raw.match(/`([A-Za-z][A-Za-z0-9_.]*)`/);
        if (backtickMatch) {
            extracted.screen = backtickMatch[1];
        }
    }
    if (!extracted.screen)
        missingFields.push("screen/component");
    // Actual behavior — look for keywords
    const actualMatch = raw.match(/(?:actual(?:ly)?|currently|instead|but|shows?|renders?|displays?|appears?|gives?|returns?|causes?)[:\s]+(.+?)(?:\.|$)/i);
    if (actualMatch) {
        extracted.actualBehavior = actualMatch[1].trim();
    }
    else {
        // If the input is short enough, it likely IS the actual behavior description
        if (raw.length < 200) {
            extracted.actualBehavior = raw;
        }
    }
    if (!extracted.actualBehavior)
        missingFields.push("actual behavior");
    // Expected behavior
    const expectedMatch = raw.match(/(?:expected|should|supposed to|want(?:ed)?|need(?:s|ed)?(?:\s+to)?|must)[:\s]+(.+?)(?:\.|$)/i);
    if (expectedMatch) {
        extracted.expectedBehavior = expectedMatch[1].trim();
    }
    if (!extracted.expectedBehavior)
        missingFields.push("expected behavior");
    // Reproduction context — require at least a clause-length match (>20 chars)
    const reproMatch = raw.match(/(?:repro(?:duce|duction)?|steps?(?:\s+to\s+repro)?|(?:happens?|occurs?)\s+when|if you)[:\s]+(.{20,}?)(?:\.|$)/i);
    if (reproMatch) {
        extracted.reproContext = reproMatch[1].trim();
    }
    if (!extracted.reproContext)
        missingFields.push("reproduction steps");
    // Build normalized request
    const normalizedRequest = buildNormalizedRequest(raw, extracted);
    return {
        normalizedRequest,
        extracted,
        missingFields,
        rawInput: raw,
    };
}
function buildNormalizedRequest(raw, extracted) {
    const parts = [];
    // Start with a structured prefix if we have enough context
    const hasStructure = extracted.platform || extracted.screen;
    if (hasStructure) {
        let prefix = "[Bug Fix]";
        if (extracted.platform)
            prefix += ` [${extracted.platform}]`;
        if (extracted.screen)
            prefix += ` [${extracted.screen}]`;
        parts.push(prefix);
    }
    else {
        parts.push("[Bug Fix]");
    }
    // Always include the original description — don't lose information
    parts.push(raw);
    // Append structured context as hints if extracted
    const hints = [];
    if (extracted.actualBehavior && extracted.actualBehavior !== raw) {
        hints.push(`Actual: ${extracted.actualBehavior}`);
    }
    if (extracted.expectedBehavior) {
        hints.push(`Expected: ${extracted.expectedBehavior}`);
    }
    if (extracted.reproContext) {
        hints.push(`Repro: ${extracted.reproContext}`);
    }
    if (hints.length > 0) {
        parts.push("---");
        parts.push(hints.join(". "));
    }
    return parts.join("\n");
}
/**
 * Generate a suggested clarified bug report from what was extracted
 * and what was missing.
 */
function suggestClarifiedReport(ctx) {
    const lines = [];
    lines.push(ctx.extracted.actualBehavior || ctx.rawInput);
    if (ctx.extracted.platform) {
        lines.push(`Platform: ${ctx.extracted.platform}.`);
    }
    else {
        lines.push("Platform: <iOS / Android / Web>.");
    }
    if (ctx.extracted.screen) {
        lines.push(`Affected screen: ${ctx.extracted.screen}.`);
    }
    else {
        lines.push("Affected screen: <screen or component name>.");
    }
    if (ctx.extracted.expectedBehavior) {
        lines.push(`Expected: ${ctx.extracted.expectedBehavior}.`);
    }
    else {
        lines.push("Expected: <what should happen instead>.");
    }
    if (ctx.extracted.reproContext) {
        lines.push(`Steps: ${ctx.extracted.reproContext}.`);
    }
    else {
        lines.push("Steps: <how to reproduce>.");
    }
    return lines.join(" ");
}
//# sourceMappingURL=bugNormalizer.js.map