"use strict";
/**
 * RefactorArtifact — structured output for refactor runs.
 *
 * Built by post-processing existing workflow artifacts (intake, design,
 * decompose, execute) into a refactor-specific shape.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRefactorArtifact = buildRefactorArtifact;
const local_1 = require("../../storage/local");
/**
 * Build a RefactorArtifact from existing workflow artifacts.
 */
function buildRefactorArtifact(run, rawRequest, category, detectedTargets) {
    const intake = (0, local_1.loadArtifact)(run.workflowId, "intake");
    const design = (0, local_1.loadArtifact)(run.workflowId, "design");
    const execute = (0, local_1.loadArtifact)(run.workflowId, "execute");
    const executePatch = (0, local_1.loadArtifact)(run.workflowId, "execute-patch");
    // Targets — from detected targets, intake title, or raw request
    let targets = detectedTargets.length > 0
        ? detectedTargets
        : [intake?.title || rawRequest.substring(0, 80)];
    // Structural issues — from design context + intake problem_statement
    const structuralIssues = extractStructuralIssues(intake, design);
    // Strategy — from design decision
    const strategy = design?.decision || "";
    // Affected files — from execute touchedArtifacts or execute-patch patches
    const affectedFiles = extractAffectedFiles(execute, executePatch, design);
    // Expected benefits — from intake success_metrics + design scope
    const expectedBenefits = extractBenefits(intake, design, category);
    // Risk analysis
    const { riskLevel, riskReason } = assessRisk(affectedFiles, strategy, design, intake);
    return {
        targets,
        category,
        structuralIssues,
        strategy,
        affectedFiles,
        expectedBenefits,
        riskLevel,
        riskReason,
    };
}
// ── Risk assessment ──────────────────────────────────────────────────
/**
 * Heuristic risk assessment based on:
 * - number of files touched
 * - dependency graph complexity (cross-module references)
 * - state mutations detected
 * - API calls / external integrations touched
 */
function assessRisk(affectedFiles, strategy, design, intake) {
    const signals = [];
    let score = 0; // 0-10 scale, higher = riskier
    // ── File count ──
    const fileCount = affectedFiles.length;
    if (fileCount >= 10) {
        score += 3;
        signals.push(`${fileCount} files affected (wide blast radius)`);
    }
    else if (fileCount >= 5) {
        score += 2;
        signals.push(`${fileCount} files affected`);
    }
    else if (fileCount >= 1) {
        score += 1;
    }
    // ── Dependency graph complexity ──
    // Detect cross-module references: files spanning multiple top-level directories
    const topDirs = new Set(affectedFiles.map((f) => f.split("/").slice(0, 2).join("/")));
    if (topDirs.size >= 4) {
        score += 2;
        signals.push(`spans ${topDirs.size} top-level modules (high coupling risk)`);
    }
    else if (topDirs.size >= 2) {
        score += 1;
        signals.push(`crosses ${topDirs.size} module boundaries`);
    }
    // ── State mutations ──
    const allText = [
        strategy,
        ...(design?.context || []),
        intake?.problem_statement || "",
    ].join(" ").toLowerCase();
    const statePatterns = /\b(redux|state|store|dispatch|reducer|slice|context|provider|usestate|setstate|mutation|atom|signal)\b/gi;
    const stateMatches = allText.match(statePatterns);
    if (stateMatches && stateMatches.length >= 3) {
        score += 2;
        signals.push("touches state management layer");
    }
    else if (stateMatches && stateMatches.length >= 1) {
        score += 1;
    }
    // ── API / external integrations ──
    const apiPatterns = /\b(api|endpoint|fetch|axios|http|request|firebase|firestore|supabase|graphql|rest|webhook|socket)\b/gi;
    const apiMatches = allText.match(apiPatterns);
    if (apiMatches && apiMatches.length >= 2) {
        score += 2;
        signals.push("involves API or external service boundaries");
    }
    else if (apiMatches && apiMatches.length >= 1) {
        score += 1;
    }
    // ── Design risks ──
    const designRisks = design?.risks;
    if (designRisks && designRisks.length >= 3) {
        score += 1;
        signals.push(`${designRisks.length} risks identified in design`);
    }
    // ── Classify ──
    let riskLevel;
    if (score >= 6) {
        riskLevel = "high";
    }
    else if (score >= 3) {
        riskLevel = "medium";
    }
    else {
        riskLevel = "low";
    }
    const riskReason = signals.length > 0
        ? signals.join("; ")
        : riskLevel === "low"
            ? "Limited scope with few dependencies"
            : "Moderate scope";
    return { riskLevel, riskReason };
}
// ── Extraction helpers ───────────────────────────────────────────────
function extractStructuralIssues(intake, design) {
    const issues = [];
    const problem = intake?.problem_statement;
    if (problem)
        issues.push(problem);
    const symptom = intake?.observable_symptom;
    if (symptom && symptom !== problem)
        issues.push(symptom);
    const context = design?.context;
    if (context) {
        const items = Array.isArray(context) ? context : [context];
        for (const item of items) {
            if (!issues.some((i) => i === item)) {
                issues.push(item);
            }
        }
    }
    return issues;
}
function extractAffectedFiles(execute, executePatch, design) {
    const files = new Set();
    const touched = execute?.touchedArtifacts;
    if (touched) {
        for (const t of touched)
            files.add(t.filePath);
    }
    const patches = executePatch?.patches;
    if (patches) {
        for (const p of patches)
            files.add(p.filePath);
    }
    const scope = design?.scope;
    if (scope?.inScope) {
        for (const item of scope.inScope) {
            const fileMatch = item.match(/\b((?:src|lib|app|components|services|hooks|utils|modules)\/[A-Za-z0-9_/.]+\.[a-z]+)\b/);
            if (fileMatch)
                files.add(fileMatch[1]);
        }
    }
    return Array.from(files);
}
function extractBenefits(intake, design, category) {
    const benefits = [];
    const metrics = intake?.success_metrics;
    if (metrics) {
        for (const m of metrics)
            benefits.push(m);
    }
    const ac = intake?.acceptance_criteria;
    if (ac && benefits.length === 0) {
        for (const criterion of ac.slice(0, 3)) {
            benefits.push(criterion);
        }
    }
    if (benefits.length === 0) {
        switch (category) {
            case "extraction":
                benefits.push("Clearer separation of concerns with dedicated module boundaries");
                break;
            case "decomposition":
                benefits.push("Smaller, focused components that are easier to test and maintain");
                break;
            case "consolidation":
                benefits.push("Single source of truth for shared logic, reduced duplication");
                break;
            case "simplification":
                benefits.push("Reduced complexity and improved readability");
                break;
            case "architecture":
                benefits.push("Enforced architectural boundaries with clear layer separation");
                break;
            case "general":
                benefits.push("Improved code organization and maintainability");
                break;
        }
    }
    return benefits;
}
//# sourceMappingURL=refactorArtifact.js.map