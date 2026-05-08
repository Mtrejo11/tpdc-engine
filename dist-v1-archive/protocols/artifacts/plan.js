"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanArtifactSchema = void 0;
const zod_1 = require("zod");
const PlanStepSchema = zod_1.z.object({
    stepNumber: zod_1.z.number().int().positive(),
    title: zod_1.z.string().min(1),
    goal: zod_1.z.string().min(1),
    surface: zod_1.z.enum([
        "web_ui", "mobile_ui", "api_endpoint", "background_job",
        "report", "admin_tool", "not_applicable", "unknown",
    ]),
    executionContext: zod_1.z.enum([
        "frontend", "backend", "database", "external_service", "infra", "not_applicable", "unknown",
    ]),
    stackAssumption: zod_1.z.enum([
        "none", "react", "next", "react_native", "expo", "python", "mixed", "not_applicable", "unknown",
    ]),
    description: zod_1.z.string().min(1),
    dependencies: zod_1.z.array(zod_1.z.number().int()).optional(),
    acceptanceCriteria: zod_1.z.string().min(1),
});
exports.PlanArtifactSchema = zod_1.z.object({
    sourceTicket: zod_1.z.string().min(1),
    designTitle: zod_1.z.string().min(1),
    status: zod_1.z.enum(["actionable", "blocked"]),
    // Present when status is "blocked"
    blockedReason: zod_1.z.string().optional(),
    unresolvedQuestions: zod_1.z.array(zod_1.z.object({
        question: zod_1.z.string().min(1),
        owner: zod_1.z.string().min(1),
    })).optional(),
    // Present when status is "actionable"
    changeStrategy: zod_1.z.string().optional(),
    risks: zod_1.z.array(zod_1.z.object({
        risk: zod_1.z.string().min(1),
        trigger: zod_1.z.string().min(1),
    })).optional(),
    validationPlan: zod_1.z.array(zod_1.z.object({
        ac: zod_1.z.string().min(1),
        verification: zod_1.z.string().min(1),
    })).optional(),
    steps: zod_1.z.array(PlanStepSchema).optional(),
}).refine((data) => {
    if (data.status === "blocked") {
        return !!data.blockedReason && !!data.unresolvedQuestions && data.unresolvedQuestions.length > 0;
    }
    if (data.status === "actionable") {
        return !!data.changeStrategy && !!data.risks && data.risks.length > 0
            && !!data.validationPlan && data.validationPlan.length > 0
            && !!data.steps && data.steps.length > 0;
    }
    return false;
}, {
    message: "Blocked plans require blockedReason + unresolvedQuestions. Actionable plans require changeStrategy + risks + validationPlan + steps.",
});
//# sourceMappingURL=plan.js.map