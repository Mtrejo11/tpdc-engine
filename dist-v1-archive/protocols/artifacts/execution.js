"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionArtifactSchema = void 0;
const zod_1 = require("zod");
const StepResultSchema = zod_1.z.object({
    stepNumber: zod_1.z.number().int().positive(),
    title: zod_1.z.string().min(1),
    status: zod_1.z.enum(["completed", "partial", "skipped", "blocked"]),
    changeSummary: zod_1.z.string().min(1),
    touchedArtifacts: zod_1.z.array(zod_1.z.string()).optional(),
    evidence: zod_1.z.string().min(1),
    blockedReason: zod_1.z.string().optional(),
});
exports.ExecutionArtifactSchema = zod_1.z.object({
    sourceTicket: zod_1.z.string().min(1),
    planTitle: zod_1.z.string().min(1),
    status: zod_1.z.enum(["completed", "partial", "failed", "blocked"]),
    appliedChangesSummary: zod_1.z.string().min(1),
    touchedArtifacts: zod_1.z.array(zod_1.z.string()).min(1),
    evidence: zod_1.z.array(zod_1.z.string()).min(1),
    stepResults: zod_1.z.array(StepResultSchema).min(1),
    notes: zod_1.z.string().optional(),
});
//# sourceMappingURL=execution.js.map