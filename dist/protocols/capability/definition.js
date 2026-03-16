"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityDefinitionSchema = exports.CapabilityStage = void 0;
const zod_1 = require("zod");
exports.CapabilityStage = zod_1.z.enum([
    "intake",
    "design",
    "decompose",
    "execute",
    "validate",
]);
exports.CapabilityDefinitionSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    version: zod_1.z.string().regex(/^\d+\.\d+\.\d+$/),
    stage: exports.CapabilityStage,
    inputArtifact: zod_1.z.string().min(1),
    outputArtifact: zod_1.z.string().min(1),
    promptVersion: zod_1.z.string().optional(),
    status: zod_1.z.enum(["draft", "evaluated", "promoted", "deprecated"]),
});
//# sourceMappingURL=definition.js.map