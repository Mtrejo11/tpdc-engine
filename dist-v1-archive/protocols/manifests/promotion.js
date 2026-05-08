"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromotionManifestSchema = void 0;
const zod_1 = require("zod");
exports.PromotionManifestSchema = zod_1.z.object({
    capabilityId: zod_1.z.string().min(1),
    version: zod_1.z.string().min(1),
    approved: zod_1.z.boolean(),
    evaluatedAt: zod_1.z.string().datetime(),
    score: zod_1.z.number().min(0).max(100),
    evaluator: zod_1.z.string().min(1),
});
//# sourceMappingURL=promotion.js.map