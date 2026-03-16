"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeArtifactSchema = void 0;
const zod_1 = require("zod");
exports.IntakeArtifactSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(120),
    source_ticket: zod_1.z.string().min(1).max(255),
    problem_statement: zod_1.z.string().min(1).max(255),
    affected_users: zod_1.z.string().min(1).max(255),
    observable_symptom: zod_1.z.string().min(1).max(255),
    acceptance_criteria: zod_1.z.array(zod_1.z.string()).min(1),
    out_of_scope: zod_1.z.array(zod_1.z.string()).optional(),
    assumptions: zod_1.z.array(zod_1.z.string()).optional(),
    open_questions: zod_1.z.array(zod_1.z.object({
        question: zod_1.z.string(),
        owner: zod_1.z.string(),
    })).optional(),
    success_metrics: zod_1.z.array(zod_1.z.string()).optional(),
    non_functional_constraints: zod_1.z.array(zod_1.z.string()).optional(),
});
//# sourceMappingURL=intake.js.map