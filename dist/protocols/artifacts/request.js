"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestArtifactSchema = void 0;
const zod_1 = require("zod");
exports.RequestArtifactSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1).max(120),
    body: zod_1.z.string().min(1),
    source: zod_1.z.string().optional(),
    projectContext: zod_1.z.object({
        techStack: zod_1.z.string().optional(),
        constraints: zod_1.z.array(zod_1.z.string()).optional(),
        repo: zod_1.z.string().optional(),
    }).optional(),
    createdAt: zod_1.z.string().datetime(),
});
//# sourceMappingURL=request.js.map