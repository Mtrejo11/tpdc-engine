import { describe, it, expect } from "vitest";
import { VERSION } from "./index.js";

describe("tpdc-engine v2", () => {
  it("exposes a version constant", () => {
    expect(VERSION).toBe("0.3.0-alpha.10");
  });
});
