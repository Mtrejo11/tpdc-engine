"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveArtifact = saveArtifact;
exports.saveRawOutput = saveRawOutput;
exports.loadArtifact = loadArtifact;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts");
function saveArtifact(runId, capabilityId, data) {
    const runDir = path.join(ARTIFACTS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const filePath = path.join(runDir, `${capabilityId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
}
function saveRawOutput(runId, capabilityId, raw) {
    const runDir = path.join(ARTIFACTS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const filePath = path.join(runDir, `${capabilityId}.raw.txt`);
    fs.writeFileSync(filePath, raw, "utf-8");
    return filePath;
}
function loadArtifact(runId, capabilityId) {
    const filePath = path.join(ARTIFACTS_DIR, runId, `${capabilityId}.json`);
    if (!fs.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=local.js.map