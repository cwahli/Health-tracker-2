import { describe, it, expect } from "vitest";
import { enforceReadyHandoffContract, synthesizeReadyHandoffPayload } from "./call_agent.js";

describe("enforceReadyHandoffContract", () => {
  it("downgrades to needs_info when model emits ready_for_handoff without demographics", () => {
    const rawOutput: any = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "ready_for_handoff",
      handoffPayload: null,
      memory: {
        goalSummary: "I want to loose weight",
        userProfileSnapshot: {}
      },
      userResponse: ""
    };

    const repaired = enforceReadyHandoffContract(rawOutput, {
      currentUserMessage: "I want to loose weight",
      existingUserProfile: null
    });

    expect(repaired.status).toBe("needs_info");
    expect(repaired.handoffPayload).toBeNull();
    expect(repaired.missingFields).toContain("age");
    expect(repaired.missingFields).toContain("gender");
    expect(repaired.missingFields).toContain("height");
    expect(repaired.missingFields).toContain("weight");
    expect(repaired.userResponse).toContain("lose weight");
  });

  it("synthesizes handoffPayload when demographics are complete", () => {
    const rawOutput: any = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "ready_for_handoff",
      handoffPayload: null,
      memory: {
        goalSummary: "Lose weight sustainably",
        userProfileSnapshot: {
          age: 28,
          gender: "female",
          heightCm: 165,
          weightKg: 62,
          activityLevel: "moderately_active"
        }
      }
    };

    const repaired = enforceReadyHandoffContract(rawOutput, {
      currentUserMessage: "Here are my stats",
      existingUserProfile: null
    });

    expect(repaired.status).toBe("ready_for_handoff");
    expect(repaired.handoffPayload).toBeTruthy();
    expect(repaired.handoffPayload.targetAgent).toBe("health_coach");
    expect(repaired.handoffPayload.summaryForAgent).toContain("Age: 28");
    expect(repaired.handoffPayload.summaryForAgent).toContain("Weight: 62kg");
    expect(repaired.userResponse).toContain("Health Coach");
  });

  it("leaves non-ready outputs untouched", () => {
    const rawOutput: any = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: ["age", "weight"]
    };

    const repaired = enforceReadyHandoffContract(rawOutput, {});
    expect(repaired.status).toBe("needs_info");
    expect(repaired.missingFields).toEqual(["age", "weight"]);
  });
});
