"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSingleCapability = runSingleCapability;
const runCapability_1 = require("../runtime/runCapability");
async function runSingleCapability(capabilityId, input, llm) {
    return (0, runCapability_1.runCapability)(capabilityId, input, { llm });
}
//# sourceMappingURL=pipeline.js.map