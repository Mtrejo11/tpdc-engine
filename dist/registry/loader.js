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
exports.listInstalledCapabilities = listInstalledCapabilities;
exports.loadCapability = loadCapability;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocols_1 = require("../protocols");
const INSTALLED_DIR = path.resolve(__dirname, "../../capabilities/installed");
// Allowlist for capability IDs and version strings — prevents path traversal
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
function assertSafePathSegment(segment, label) {
    if (!SAFE_ID_PATTERN.test(segment)) {
        throw new Error(`Invalid ${label}: "${segment}" — only alphanumeric, dot, dash, and underscore allowed`);
    }
}
function listInstalledCapabilities() {
    if (!fs.existsSync(INSTALLED_DIR))
        return [];
    const capabilities = [];
    const dirs = fs.readdirSync(INSTALLED_DIR);
    for (const dir of dirs) {
        const capDir = path.join(INSTALLED_DIR, dir);
        if (!fs.statSync(capDir).isDirectory())
            continue;
        // Check version subdirectories
        const versions = fs.readdirSync(capDir);
        for (const ver of versions) {
            const verDir = path.join(capDir, ver);
            if (!fs.statSync(verDir).isDirectory())
                continue;
            const manifestPath = path.join(verDir, "capability.json");
            if (fs.existsSync(manifestPath)) {
                const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
                const parsed = protocols_1.CapabilityDefinitionSchema.parse(raw);
                capabilities.push(parsed);
            }
        }
    }
    return capabilities;
}
function loadCapability(id, version) {
    if (!fs.existsSync(INSTALLED_DIR))
        return null;
    assertSafePathSegment(id, "capability ID");
    const capDir = path.join(INSTALLED_DIR, id);
    if (!capDir.startsWith(INSTALLED_DIR + path.sep))
        return null;
    if (!fs.existsSync(capDir))
        return null;
    let targetVersion = version;
    if (!targetVersion) {
        // Use latest version (proper semver sort)
        const versions = fs.readdirSync(capDir).filter(v => {
            const vPath = path.join(capDir, v);
            return fs.statSync(vPath).isDirectory();
        });
        if (versions.length === 0)
            return null;
        targetVersion = versions.sort(compareSemver).pop();
    }
    else {
        assertSafePathSegment(targetVersion, "capability version");
    }
    const verDir = path.join(capDir, targetVersion);
    if (!fs.existsSync(verDir))
        return null;
    const manifestPath = path.join(verDir, "capability.json");
    const promptPath = path.join(verDir, "prompt.md");
    const inputSchemaPath = path.join(verDir, "input.schema.json");
    const outputSchemaPath = path.join(verDir, "output.schema.json");
    if (!fs.existsSync(manifestPath))
        return null;
    const definition = protocols_1.CapabilityDefinitionSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf-8")));
    const prompt = fs.existsSync(promptPath)
        ? fs.readFileSync(promptPath, "utf-8")
        : "";
    const inputSchema = fs.existsSync(inputSchemaPath)
        ? JSON.parse(fs.readFileSync(inputSchemaPath, "utf-8"))
        : {};
    const outputSchema = fs.existsSync(outputSchemaPath)
        ? JSON.parse(fs.readFileSync(outputSchemaPath, "utf-8"))
        : {};
    return { definition, prompt, inputSchema, outputSchema, basePath: verDir };
}
function compareSemver(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0))
            return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
}
//# sourceMappingURL=loader.js.map