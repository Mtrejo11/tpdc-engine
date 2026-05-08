import { describe, it, expect } from "vitest";
import { inngest } from "./client.js";

describe("inngest client", () => {
  it("is configured with the tpdc-engine id", () => {
    expect(inngest.id).toBe("tpdc-engine");
  });
});
