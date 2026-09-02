import { describe, expect, it } from "vitest";
import { sanitizeReceptionistJson } from "./call_agent.js";

describe("sanitizeReceptionistJson", () => {
  it("repairs runaway weightKg decimals so JSON.parse succeeds", () => {
    const raw = "{\"weightKg\":" + "74." + "0".repeat(80) + ",\"intent\":\"weight_loss\"}";
    const parsed = JSON.parse(sanitizeReceptionistJson(raw));
    expect(parsed.weightKg).toBe(74);
    expect(parsed.intent).toBe("weight_loss");
  });
});
