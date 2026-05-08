/**
 * Tests for the TPDC Claude integration layer.
 *
 * Tests:
 * 1. Parser — valid invocations
 * 2. Parser — invalid / non-TPDC input
 * 3. Parser — flag extraction
 * 4. isTpdcInvocation guard
 * 5. handleTpdcInvocation — non-TPDC text
 * 6. handleTpdcInvocation — invalid command
 * 7. handleTpdcInvocation — show (no args)
 * 8. Claude-facing output format
 */

import { parseInvocation, isTpdcInvocation, ParsedInvocation } from "../src/integration/parser";
import { handleTpdcInvocation, TpdcResponse } from "../src/integration/claude";
import { MockLLMAdapter } from "../src/runtime/types";

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

// ── Test 1: Parser — valid invocations ───────────────────────────────

console.log("\n[Test 1] Parser — valid invocations\n");
{
  // Basic commands
  const fix = parseInvocation('tpdc:fix "Camera permission broken"');
  assert(fix !== null, "Parses tpdc:fix");
  assert(fix!.command === "fix", `Command is fix (got ${fix!.command})`);
  assert(fix!.args === "Camera permission broken", `Args extracted (got "${fix!.args}")`);

  const solve = parseInvocation('tpdc:solve "Implement tenant reset on logout"');
  assert(solve !== null, "Parses tpdc:solve");
  assert(solve!.command === "solve", "Command is solve");
  assert(solve!.args.includes("tenant reset"), "Args include content");

  const discovery = parseInvocation('tpdc:discovery "We need to improve offline image reliability"');
  assert(discovery !== null, "Parses tpdc:discovery");
  assert(discovery!.command === "discovery", "Command is discovery");

  const assess = parseInvocation('tpdc:assess "Evaluate security risks in upload pipeline"');
  assert(assess !== null, "Parses tpdc:assess");
  assert(assess!.command === "assess", "Command is assess");

  const plan = parseInvocation('tpdc:plan "Port Models Download from Pocket to HQ"');
  assert(plan !== null, "Parses tpdc:plan");
  assert(plan!.command === "plan", "Command is plan");

  const refactor = parseInvocation('tpdc:refactor "Split PlantViewModal into smaller components"');
  assert(refactor !== null, "Parses tpdc:refactor");
  assert(refactor!.command === "refactor", "Command is refactor");

  // Show with runId
  const show = parseInvocation("tpdc:show abc12345");
  assert(show !== null, "Parses tpdc:show with runId");
  assert(show!.command === "show", "Command is show");
  assert(show!.args === "abc12345", `Args is runId (got "${show!.args}")`);

  // Show without args
  const showEmpty = parseInvocation("tpdc:show");
  assert(showEmpty !== null, "Parses tpdc:show without args");
  assert(showEmpty!.args === "", "Empty args for show");

  // Diff
  const diff = parseInvocation("tpdc:diff wf_123");
  assert(diff !== null, "Parses tpdc:diff");
  assert(diff!.command === "diff", "Command is diff");
  assert(diff!.args === "wf_123", "Args is runId");
}

// ── Test 2: Parser — invalid / non-TPDC input ───────────────────────

console.log("\n[Test 2] Parser — non-TPDC input\n");
{
  assert(parseInvocation("Fix the camera bug") === null, "Rejects plain text");
  assert(parseInvocation("Please fix the camera") === null, "Rejects natural language");
  assert(parseInvocation("tpdc fix something") === null, "Rejects tpdc without colon");
  assert(parseInvocation("tpdc:unknown command") === null, "Rejects unknown command");
  assert(parseInvocation("tpdc:") === null, "Rejects empty command");
  assert(parseInvocation("") === null, "Rejects empty string");
  assert(parseInvocation("klaus:spec something") === null, "Rejects other plugin namespaces");
  assert(parseInvocation("What is tpdc:fix?") === null, "Rejects non-leading tpdc:");
}

// ── Test 3: Parser — flag extraction ─────────────────────────────────

console.log("\n[Test 3] Flag extraction\n");
{
  const withApply = parseInvocation('tpdc:solve "Fix bug" --apply --repo-root /path/to/repo');
  assert(withApply !== null, "Parses with --apply flag");
  assert(withApply!.flags.apply === true, "apply flag set");
  assert(withApply!.flags.repoRoot === "/path/to/repo", `repoRoot extracted (got "${withApply!.flags.repoRoot}")`);
  assert(withApply!.args === "Fix bug", `Args cleaned of flags (got "${withApply!.args}")`);

  const withConfirm = parseInvocation('tpdc:fix "Bug" --apply --confirm-apply --repo-root ~/project');
  assert(withConfirm!.flags.apply === true, "apply flag set");
  assert(withConfirm!.flags.confirmApply === true, "confirmApply flag set");
  assert(withConfirm!.flags.repoRoot === "~/project", "repoRoot extracted");

  const withInteractive = parseInvocation('tpdc:refactor "Split component" --apply --interactive --repo-root /repo');
  assert(withInteractive!.flags.interactive === true, "interactive flag set");

  const noFlags = parseInvocation('tpdc:assess "Check security"');
  assert(noFlags!.flags.apply === undefined, "No apply flag");
  assert(noFlags!.flags.repoRoot === undefined, "No repoRoot");
}

// ── Test 4: isTpdcInvocation guard ───────────────────────────────────

console.log("\n[Test 4] isTpdcInvocation guard\n");
{
  assert(isTpdcInvocation('tpdc:fix "bug"') === true, "Recognizes tpdc:fix");
  assert(isTpdcInvocation('tpdc:solve "request"') === true, "Recognizes tpdc:solve");
  assert(isTpdcInvocation("tpdc:show") === true, "Recognizes tpdc:show");
  assert(isTpdcInvocation("fix the bug") === false, "Rejects plain text");
  assert(isTpdcInvocation("") === false, "Rejects empty");
  assert(isTpdcInvocation("Please run tpdc:fix") === false, "Rejects non-leading");
  assert(isTpdcInvocation("TPDC:fix bug") === true, "Case insensitive");
}

// ── Async tests (wrapped in main) ────────────────────────────────────

async function runAsyncTests() {

// ── Test 5: handleTpdcInvocation — non-TPDC text ─────────────────────

console.log("\n[Test 5] handleTpdcInvocation — non-TPDC\n");
{
  const result = await handleTpdcInvocation("Fix the camera permission bug", { llm: new MockLLMAdapter() });
  assert(result.handled === false, "Not handled");
  assert(result.output === "", "Empty output");
  assert(result.meta === undefined, "No meta");
}

// ── Test 6: handleTpdcInvocation — invalid command ───────────────────

console.log("\n[Test 6] handleTpdcInvocation — invalid command\n");
{
  const result = await handleTpdcInvocation("tpdc:invalid something", { llm: new MockLLMAdapter() });
  assert(result.handled === true, "Handled (recognized tpdc: prefix)");
  assert(result.output.includes("Unknown TPDC command"), "Shows error message");
  assert(result.output.includes("Available commands"), "Shows available commands");
  assert(result.output.includes("tpdc:fix"), "Lists fix");
  assert(result.output.includes("tpdc:solve"), "Lists solve");
  assert(result.output.includes("tpdc:discovery"), "Lists discovery");
}

// ── Test 7: handleTpdcInvocation — show (no args, list) ──────────────

console.log("\n[Test 7] handleTpdcInvocation — show list\n");
{
  const result = await handleTpdcInvocation("tpdc:show", { llm: new MockLLMAdapter() });
  assert(result.handled === true, "Handled");
  assert(result.meta?.command === "show", "Command is show");
  assert(
    result.output.includes("Recent runs") || result.output.includes("No workflow runs"),
    "Shows run list or empty message",
  );
}

// ── Test 8: Claude-facing output format ──────────────────────────────

console.log("\n[Test 8] Claude-facing output format\n");
{
  const result = await handleTpdcInvocation("tpdc:show", { llm: new MockLLMAdapter() });
  assert(result.handled === true, "Handled");
  assert(result.output.includes("```"), "Output wrapped in code fences");
}

// ── Test 9: Parser case insensitivity ────────────────────────────────

console.log("\n[Test 9] Case insensitivity\n");
{
  const upper = parseInvocation('TPDC:FIX "bug"');
  assert(upper !== null, "Parses uppercase");
  assert(upper!.command === "fix", "Command normalized to lowercase");

  const mixed = parseInvocation('Tpdc:Solve "request"');
  assert(mixed !== null, "Parses mixed case");
  assert(mixed!.command === "solve", "Command normalized");
}

// ── Test 10: Multiline args ──────────────────────────────────────────

console.log("\n[Test 10] Args with special content\n");
{
  // Single-quoted args
  const single = parseInvocation("tpdc:fix 'Camera bug on Android'");
  assert(single !== null, "Parses single-quoted args");
  assert(single!.args === "Camera bug on Android", "Single quotes stripped");

  // No quotes
  const noQuotes = parseInvocation("tpdc:fix Camera bug on Android");
  assert(noQuotes !== null, "Parses unquoted args");
  assert(noQuotes!.args === "Camera bug on Android", "Unquoted args preserved");

  // Args with dashes (not flags)
  const dashes = parseInvocation('tpdc:fix "Camera - no thumbnail - broken"');
  assert(dashes !== null, "Parses args with dashes");
  assert(dashes!.args.includes("no thumbnail"), "Dashes in content preserved");
}

// ── Test 11: All command types recognized ────────────────────────────

console.log("\n[Test 11] All command types\n");
{
  const commands = ["discovery", "assess", "plan", "solve", "fix", "refactor", "show", "diff"];
  for (const cmd of commands) {
    const parsed = parseInvocation(`tpdc:${cmd} test`);
    assert(parsed !== null && parsed.command === cmd, `tpdc:${cmd} recognized`);
  }
}

// ── Test 12: Error response structure ────────────────────────────────

console.log("\n[Test 12] Error response structure\n");
{
  const noArgs = await handleTpdcInvocation("tpdc:diff", { llm: new MockLLMAdapter() });
  assert(noArgs.handled === true, "Handled even with missing args");
  assert(noArgs.meta?.error !== undefined, "Has error in meta");
}

} // end runAsyncTests

// ── Run all ──────────────────────────────────────────────────────────

runAsyncTests().then(() => {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
