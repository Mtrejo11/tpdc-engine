"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDevelopResult = exports.runDevelop = exports.handleTpdcInvocation = exports.dispatch = exports.parseDevelopArgs = exports.isTpdcInvocation = exports.parseInvocation = void 0;
var parser_1 = require("./parser");
Object.defineProperty(exports, "parseInvocation", { enumerable: true, get: function () { return parser_1.parseInvocation; } });
Object.defineProperty(exports, "isTpdcInvocation", { enumerable: true, get: function () { return parser_1.isTpdcInvocation; } });
Object.defineProperty(exports, "parseDevelopArgs", { enumerable: true, get: function () { return parser_1.parseDevelopArgs; } });
var dispatcher_1 = require("./dispatcher");
Object.defineProperty(exports, "dispatch", { enumerable: true, get: function () { return dispatcher_1.dispatch; } });
var claude_1 = require("./claude");
Object.defineProperty(exports, "handleTpdcInvocation", { enumerable: true, get: function () { return claude_1.handleTpdcInvocation; } });
var develop_1 = require("./develop");
Object.defineProperty(exports, "runDevelop", { enumerable: true, get: function () { return develop_1.runDevelop; } });
Object.defineProperty(exports, "renderDevelopResult", { enumerable: true, get: function () { return develop_1.renderDevelopResult; } });
//# sourceMappingURL=index.js.map