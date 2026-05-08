"use strict";
/**
 * Assessment request normalizer.
 *
 * Tags the request as an analysis/audit and extracts the assessment
 * category so the workflow and renderer can specialize output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAssessment = normalizeAssessment;
const CATEGORY_PATTERNS = [
    [/\b(secur\w*|vuln\w*|auth\w*|injection|xss|csrf|leak\w*|expos\w*|permiss\w*|access.?control|encrypt\w*|token\w*|credential\w*|secret\w*|sanitiz\w*|escap\w*|tenant|cross.?tenant|privilege\w*|exploit\w*)\b/i, "security"],
    [/\b(perf\w*|latenc\w*|throughput|bottleneck\w*|slow\w*|fast\w*|optim\w*|memory|cpu|render\w*|frame\w*|fps|bundle.?size|load.?time|cach\w*|debounce|throttl\w*|lazy|eager|profil\w*|batch\w*)\b/i, "performance"],
    [/\b(architect\w*|design.?pattern|coupling|cohes\w*|abstraction\w*|layer\w*|module\w*|depend\w*|circular|refactor\w*|structur\w*|separation|concern\w*|solid|dry|encapsulat\w*|interface\w*|contract\w*|boundary\w*)\b/i, "architecture"],
];
function normalizeAssessment(raw) {
    let category = "general";
    for (const [pattern, cat] of CATEGORY_PATTERNS) {
        if (pattern.test(raw)) {
            category = cat;
            break;
        }
    }
    const categoryLabel = category === "general" ? "Analysis" : `${capitalize(category)} Assessment`;
    const normalizedRequest = [
        `[Assessment] [${categoryLabel}]`,
        `Analyze and evaluate the following. Do NOT propose code changes or patches.`,
        `Focus on identifying risks, findings, and recommended actions.`,
        "",
        raw,
    ].join("\n");
    return {
        normalizedRequest,
        category,
        rawInput: raw,
    };
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
//# sourceMappingURL=assessNormalizer.js.map