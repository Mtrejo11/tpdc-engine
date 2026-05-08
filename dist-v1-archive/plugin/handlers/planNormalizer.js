"use strict";
/**
 * Plan request normalizer.
 *
 * Tags the request as a planning exercise and detects
 * the likely execution command for the suggested next step.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePlan = normalizePlan;
const COMMAND_PATTERNS = [
    [/\b(bug\w*|crash\w*|broken|fail\w*|error\w*|wrong|regress\w*|not\s+work\w*)\b/i, "fix"],
    [/\b(port\w*|migrat\w*|move\s+from|transition\w*|replac\w*|swap\w*|switch\s+from|upgrade\w*)\b/i, "migrate"],
    [/\b(refactor\w*|clean\s*up|restructur\w*|reorganiz\w*|decouple\w*|extract\w*|simplif\w*|consolidat\w*|split\w*)\b/i, "refactor"],
];
function normalizePlan(raw) {
    let likelyCommand = "solve";
    for (const [pattern, cmd] of COMMAND_PATTERNS) {
        if (pattern.test(raw)) {
            likelyCommand = cmd;
            break;
        }
    }
    const normalizedRequest = [
        `[Plan] Produce a detailed technical implementation plan for the following.`,
        `Do NOT generate code, patches, or mutations.`,
        `Focus on: objective, scope, assumptions, risks, affected modules and files,`,
        `ordered implementation phases with dependencies, and a validation approach.`,
        `Identify what is missing or unclear that would block execution.`,
        "",
        raw,
    ].join("\n");
    return {
        normalizedRequest,
        likelyCommand,
        rawInput: raw,
    };
}
//# sourceMappingURL=planNormalizer.js.map