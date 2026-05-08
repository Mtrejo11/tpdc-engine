"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpecArtifactSchema = void 0;
const zod_1 = require("zod");
exports.SpecArtifactSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    status: zod_1.z.enum(["proposed", "accepted", "superseded", "deprecated"]),
    date: zod_1.z.string().min(1),
    sourceTicket: zod_1.z.string().min(1),
    context: zod_1.z.array(zod_1.z.string()).min(1),
    decision: zod_1.z.string().min(1),
    scope: zod_1.z.object({
        inScope: zod_1.z.array(zod_1.z.string()).min(1),
        outOfScope: zod_1.z.array(zod_1.z.string()).min(1),
    }),
    validationPlan: zod_1.z.array(zod_1.z.object({
        ac: zod_1.z.string().min(1),
        verification: zod_1.z.string().min(1),
    })).min(1),
    risks: zod_1.z.array(zod_1.z.object({
        risk: zod_1.z.string().min(1),
        trigger: zod_1.z.string().min(1),
        mitigation: zod_1.z.string().min(1),
        detection: zod_1.z.string().min(1),
    })).min(3),
    alternatives: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string().min(1),
        reasonRejected: zod_1.z.string().min(1),
    })).min(2),
    openQuestions: zod_1.z.array(zod_1.z.object({
        question: zod_1.z.string().min(1),
        owner: zod_1.z.string().min(1),
    })).optional(),
});
//# sourceMappingURL=spec.js.map