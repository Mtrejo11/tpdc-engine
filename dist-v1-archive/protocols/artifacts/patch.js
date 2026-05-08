"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchArtifactSchema = void 0;
const zod_1 = require("zod");
const PatchItemSchema = zod_1.z.object({
    stepNumber: zod_1.z.number().int().positive(),
    filePath: zod_1.z.string().min(1),
    operation: zod_1.z.enum(["create", "modify", "delete"]),
    diff: zod_1.z.string().min(1),
    justification: zod_1.z.string().min(1),
});
exports.PatchArtifactSchema = zod_1.z.object({
    sourceTicket: zod_1.z.string().min(1),
    planTitle: zod_1.z.string().min(1),
    executionMode: zod_1.z.literal("patch"),
    executionStatus: zod_1.z.enum(["completed", "partial", "blocked", "insufficient_context"]),
    targetFiles: zod_1.z.array(zod_1.z.string()).min(1),
    changeSummary: zod_1.z.string().min(1),
    patches: zod_1.z.array(PatchItemSchema).optional(),
    assumptions: zod_1.z.array(zod_1.z.string()).optional(),
    risks: zod_1.z.array(zod_1.z.string()).optional(),
    blockedReason: zod_1.z.string().optional(),
    missingContext: zod_1.z.array(zod_1.z.string()).optional(),
    notes: zod_1.z.string().optional(),
}).refine((data) => {
    if (data.executionStatus === "blocked") {
        return !!data.blockedReason;
    }
    if (data.executionStatus === "insufficient_context") {
        return !!data.missingContext && data.missingContext.length > 0;
    }
    if (data.executionStatus === "completed" || data.executionStatus === "partial") {
        return !!data.patches && data.patches.length > 0;
    }
    return false;
}, {
    message: "Blocked requires blockedReason. Insufficient context requires missingContext. Completed/partial require patches.",
});
//# sourceMappingURL=patch.js.map