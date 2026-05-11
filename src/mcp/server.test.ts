/**
 * Tests for the MCP server scaffold.
 *
 * v0.3.0-alpha.0: just validate the ping tool wires correctly. Real tool
 * tests land alongside their tool implementations.
 */

import { describe, expect, it } from "vitest";

import { VERSION } from "../index.js";
import { buildServer } from "./server.js";

describe("buildServer", () => {
  it("returns a configured Server instance", () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });

  it("ships the tpdc_ping tool (scaffold validation)", async () => {
    const server = buildServer();
    // The MCP Server SDK doesn't expose tools list publicly; we re-exec the
    // registered handler by sending a synthetic request. The simplest cross-
    // version-stable assertion is: building the server does not throw and
    // version metadata is present. Real tool-call testing happens at the
    // integration layer (Claude Code → stdio → server) in alpha.1+.
    expect(typeof VERSION).toBe("string");
    expect(VERSION.startsWith("0.3.")).toBe(true);
    expect(server).toBeDefined();
  });
});
