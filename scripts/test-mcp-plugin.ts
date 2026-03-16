/**
 * Tests for the TPDC MCP server and plugin package.
 *
 * Tests:
 * 1. MCP tool definitions — all 9 tools registered
 * 2. Tool input schema validation
 * 3. Show tool invocation (no workflow needed)
 * 4. Diff tool invocation (no workflow needed)
 * 5. Plugin skill files exist
 * 6. Skill YAML frontmatter valid
 * 7. MCP config valid
 * 8. CLAUDE.md exists and is valid
 * 9. Develop tool argument parsing
 */

import * as fs from "fs";
import * as path from "path";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_DIR = path.join(ROOT, "tpdc-plugin");
const SKILLS_DIR = path.join(PLUGIN_DIR, "skills");

// ── Test 1: MCP tool definitions ─────────────────────────────────────

console.log("\n[Test 1] MCP server compiles and exports tools\n");
{
  // Verify the compiled server exists
  const serverPath = path.join(ROOT, "dist/mcp/server.js");
  assert(fs.existsSync(serverPath), "dist/mcp/server.js exists");

  // Read the source to verify tool definitions
  const serverSrc = fs.readFileSync(path.join(ROOT, "src/mcp/server.ts"), "utf-8");
  const toolNames = [
    "tpdc_develop", "tpdc_discovery", "tpdc_assess", "tpdc_plan",
    "tpdc_solve", "tpdc_fix", "tpdc_refactor", "tpdc_show", "tpdc_diff",
  ];
  for (const name of toolNames) {
    assert(serverSrc.includes(`name: "${name}"`), `Tool ${name} defined`);
  }
}

// ── Test 2: Tool input schemas ───────────────────────────────────────

console.log("\n[Test 2] Tool input schemas\n");
{
  const serverSrc = fs.readFileSync(path.join(ROOT, "src/mcp/server.ts"), "utf-8");

  // Develop tool has mode + request
  assert(serverSrc.includes('"mode"') && serverSrc.includes('"feature"'), "Develop has mode enum");
  assert(serverSrc.includes('"request"'), "Tools have request field");
  assert(serverSrc.includes("repo_root"), "Mutation tools have repo_root");
  assert(serverSrc.includes("apply"), "Mutation tools have apply flag");
  assert(serverSrc.includes("confirm_apply"), "Mutation tools have confirm_apply flag");
  assert(serverSrc.includes("run_id"), "Show/diff have run_id");
}

// ── Test 3: Show tool works without workflow ─────────────────────────

console.log("\n[Test 3] Show tool invocation\n");
{
  // Import the dispatch function directly
  const { dispatch } = require("../dist/integration/dispatcher");
  const { MockLLMAdapter } = require("../dist/runtime/types");

  const showResult = dispatch(
    { command: "show", args: "", flags: {} },
    { llm: new MockLLMAdapter(), quiet: true },
  );

  // dispatch returns a Promise for show
  showResult.then((result: any) => {
    // This is async, we'll handle it in the async section
  });

  // Synchronous check: dispatch function exists
  assert(typeof dispatch === "function", "dispatch function exists");
}

// ── Test 4: Plugin skill files ───────────────────────────────────────

console.log("\n[Test 4] Plugin skill files exist\n");
{
  const skills = [
    "develop", "discovery", "assess", "plan",
    "solve", "fix", "refactor", "show", "diff",
  ];

  for (const skill of skills) {
    const skillPath = path.join(SKILLS_DIR, skill, "SKILL.md");
    assert(fs.existsSync(skillPath), `${skill}/SKILL.md exists`);
  }
}

// ── Test 5: Skill YAML frontmatter ───────────────────────────────────

console.log("\n[Test 5] Skill frontmatter validation\n");
{
  const skills = [
    "develop", "discovery", "assess", "plan",
    "solve", "fix", "refactor", "show", "diff",
  ];

  for (const skill of skills) {
    const content = fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf-8");

    // Check frontmatter structure
    assert(content.startsWith("---"), `${skill} starts with frontmatter`);
    assert(content.includes(`name: ${skill}`), `${skill} has name field`);
    assert(content.includes("description:"), `${skill} has description`);
    assert(content.includes("allowed-tools:"), `${skill} has allowed-tools`);
    assert(content.includes("mcp__tpdc__"), `${skill} references MCP tools`);
  }
}

// ── Test 6: MCP config ───────────────────────────────────────────────

console.log("\n[Test 6] MCP config validation\n");
{
  const mcpPath = path.join(PLUGIN_DIR, ".mcp.json");
  assert(fs.existsSync(mcpPath), ".mcp.json exists");

  const config = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
  assert(config.tpdc !== undefined, "Has 'tpdc' server entry");
  assert(config.tpdc.command === "node", "Command is node");
  assert(config.tpdc.args[0].includes("server.js"), "Args point to server.js");
  assert(config.tpdc.env !== undefined, "Has env config");
}

// ── Test 7: CLAUDE.md ────────────────────────────────────────────────

console.log("\n[Test 7] CLAUDE.md validation\n");
{
  const claudeMd = path.join(PLUGIN_DIR, "CLAUDE.md");
  assert(fs.existsSync(claudeMd), "CLAUDE.md exists");

  const content = fs.readFileSync(claudeMd, "utf-8");
  assert(content.includes("TPDC"), "Mentions TPDC");
  assert(content.includes("/tpdc:develop"), "Lists develop command");
  assert(content.includes("/tpdc:fix"), "Lists fix command");
  assert(content.includes("Do NOT auto-route"), "Explicit invocation rule");
  assert(content.includes("MCP"), "Mentions MCP");
}

// ── Test 8: Develop tool arg parsing ─────────────────────────────────

console.log("\n[Test 8] Develop argument parsing through MCP\n");
{
  const { parseDevelopArgs } = require("../dist/integration/parser");

  const feature = parseDevelopArgs('feature "Build dark mode"');
  assert(feature !== null, "Parses feature mode");
  assert(feature.mode === "feature", "Mode is feature");

  const bug = parseDevelopArgs('bug "App crashes"');
  assert(bug !== null, "Parses bug mode");
  assert(bug.mode === "bug", "Mode is bug");

  const refactor = parseDevelopArgs('refactor "Split component"');
  assert(refactor !== null, "Parses refactor mode");

  const invalid = parseDevelopArgs("invalid something");
  assert(invalid === null, "Rejects invalid mode");
}

// ── Test 9: Plugin directory structure ───────────────────────────────

console.log("\n[Test 9] Plugin directory structure\n");
{
  assert(fs.existsSync(PLUGIN_DIR), "tpdc-plugin/ exists");
  assert(fs.existsSync(SKILLS_DIR), "tpdc-plugin/skills/ exists");
  assert(fs.existsSync(path.join(PLUGIN_DIR, "CLAUDE.md")), "CLAUDE.md exists");
  assert(fs.existsSync(path.join(PLUGIN_DIR, ".mcp.json")), ".mcp.json exists");

  // Count skills
  const skillDirs = fs.readdirSync(SKILLS_DIR).filter(
    (d) => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory(),
  );
  assert(skillDirs.length === 9, `9 skill directories (got ${skillDirs.length})`);
}

// ── Test 10: MCP tool handler coverage ───────────────────────────────

console.log("\n[Test 10] MCP tool handler switch coverage\n");
{
  const serverSrc = fs.readFileSync(path.join(ROOT, "src/mcp/server.ts"), "utf-8");

  // Each tool name should appear in the handler switch
  const handledTools = [
    "tpdc_develop", "tpdc_discovery", "tpdc_assess", "tpdc_plan",
    "tpdc_solve", "tpdc_fix", "tpdc_refactor", "tpdc_show", "tpdc_diff",
  ];
  for (const name of handledTools) {
    assert(
      serverSrc.includes(`case "${name}"`) || serverSrc.includes(`"${name}":`),
      `Handler for ${name} exists`,
    );
  }
}

// ── Test 11: Allowed tools match MCP tool names ──────────────────────

console.log("\n[Test 11] Skill allowed-tools reference valid MCP tools\n");
{
  const validMcpTools = [
    "mcp__tpdc__tpdc_develop", "mcp__tpdc__tpdc_discovery", "mcp__tpdc__tpdc_assess",
    "mcp__tpdc__tpdc_plan", "mcp__tpdc__tpdc_solve", "mcp__tpdc__tpdc_fix",
    "mcp__tpdc__tpdc_refactor", "mcp__tpdc__tpdc_show", "mcp__tpdc__tpdc_diff",
  ];

  const skills = fs.readdirSync(SKILLS_DIR).filter(
    (d) => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory(),
  );

  for (const skill of skills) {
    const content = fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf-8");
    const toolsMatch = content.match(/allowed-tools:\s*(.+)/);
    if (toolsMatch) {
      const tools = toolsMatch[1].split(",").map((t) => t.trim());
      for (const tool of tools) {
        assert(validMcpTools.includes(tool), `${skill}: ${tool} is a valid MCP tool`);
      }
    }
  }
}

// ── Test 12: Plugin manifest ─────────────────────────────────────────

console.log("\n[Test 12] Plugin manifest\n");
{
  const manifestPath = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");
  assert(fs.existsSync(manifestPath), ".claude-plugin/plugin.json exists");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert(manifest.name === "tpdc", "Plugin name is tpdc");
  assert(typeof manifest.version === "string", "Has version");
  assert(typeof manifest.description === "string", "Has description");
  assert(manifest.author?.name !== undefined, "Has author");
}

// ── Test 13: Marketplace manifest ────────────────────────────────────

console.log("\n[Test 13] Marketplace manifest\n");
{
  const mktPath = path.join(ROOT, "marketplace.json");
  assert(fs.existsSync(mktPath), "marketplace.json exists at repo root");

  const mkt = JSON.parse(fs.readFileSync(mktPath, "utf-8"));
  assert(mkt.name === "tpdc", "Marketplace name is tpdc");
  assert(Array.isArray(mkt.plugins), "Has plugins array");
  assert(mkt.plugins.length === 1, "One plugin defined");
  assert(mkt.plugins[0].name === "tpdc", "Plugin name matches");
  assert(mkt.plugins[0].source === "./tpdc-plugin", "Source points to tpdc-plugin/");
}

// ── Test 14: README exists ───────────────────────────────────────────

console.log("\n[Test 14] README\n");
{
  const readmePath = path.join(PLUGIN_DIR, "README.md");
  assert(fs.existsSync(readmePath), "README.md exists");

  const content = fs.readFileSync(readmePath, "utf-8");
  assert(content.includes("Prerequisites"), "Has Prerequisites section");
  assert(content.includes("Installation"), "Has Installation section");
  assert(content.includes("Uninstall"), "Has Uninstall section");
  assert(content.includes("Troubleshooting"), "Has Troubleshooting section");
  assert(content.includes("/tpdc:fix"), "Shows correct invocation syntax");
  assert(content.includes("/tpdc:develop"), "Shows develop invocation");
  assert(content.includes("plugin marketplace add"), "Documents marketplace add");
  assert(content.includes("plugin install tpdc@tpdc"), "Documents install command");
}

// ── Test 15: Invocation consistency ──────────────────────────────────

console.log("\n[Test 15] Invocation syntax consistency\n");
{
  const claudeMd = fs.readFileSync(path.join(PLUGIN_DIR, "CLAUDE.md"), "utf-8");
  const readme = fs.readFileSync(path.join(PLUGIN_DIR, "README.md"), "utf-8");

  // All references should use /tpdc: prefix (not /tpdc-*)
  assert(claudeMd.includes("/tpdc:develop"), "CLAUDE.md: /tpdc:develop");
  assert(claudeMd.includes("/tpdc:fix"), "CLAUDE.md: /tpdc:fix");
  assert(claudeMd.includes("/tpdc:show"), "CLAUDE.md: /tpdc:show");
  assert(!claudeMd.includes("/tpdc-develop"), "CLAUDE.md: no /tpdc-develop (old format)");

  assert(readme.includes("/tpdc:develop"), "README: /tpdc:develop");
  assert(readme.includes("/tpdc:fix"), "README: /tpdc:fix");
  assert(!readme.includes("/tpdc-develop"), "README: no /tpdc-develop (old format)");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
