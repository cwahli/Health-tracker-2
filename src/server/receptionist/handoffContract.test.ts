import { describe, it, expect } from "vitest";
import { enforceReadyHandoffContract, maybePromoteHandoff, synthesizeReadyHandoffPayload } from "./call_agent.js";

const completeProfile = {
  age: 43,
  gender: "Male",
  heightCm: 163,
  weightKg: 60,
  activityLevel: "sedentary"
};

function runPostProcessor(output: any, ctx: { currentUserMessage?: string; existingUserProfile?: any }) {
  const promoted = maybePromoteHandoff({ ...output }, ctx);
  return enforceReadyHandoffContract(promoted, ctx);
}

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

describe("maybePromoteHandoff + contract (U0 / C1 / C5)", () => {
  it("U0: 'i want' with a complete profile stays at Front Desk", () => {
    const raw = {
      intent: "general_wellness",
      targetAgent: "general_receptionist",
      status: "needs_info",
      missingFields: [],
      handoffPayload: null,
      userResponse: "It looks like your sentence got cut off. How can I help you today?",
      uiForm: { formId: "general_inquiry_form", fields: [{ name: "goal" }] },
      memory: { goalSummary: "Explore available health services.", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "i want",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("needs_info");
    expect(out.targetAgent).toBe("general_receptionist");
    expect(out.handoffPayload).toBeNull();
    expect(out.userResponse).toMatch(/cut off/i);
    expect(out.uiForm?.formId).toBe("general_inquiry_form");
  });

  it("C1 empty profile: weight loss stays needs_info", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: ["age", "gender", "height", "weight"],
      handoffPayload: null,
      memory: { goalSummary: "User wants to lose weight.", userProfileSnapshot: {} }
    };
    const out = runPostProcessor(raw, { currentUserMessage: "I want to loose weight", existingUserProfile: null });
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
  });

  it("C1b: weight_loss + complete demographics promotes to health_coach", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: [],
      handoffPayload: null,
      memory: { goalSummary: "Lose weight sustainably", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "Here are my stats: 43, male, 163cm, 60kg, sedentary",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("ready_for_handoff");
    expect(out.targetAgent).toBe("health_coach");
    expect(out.handoffPayload).toBeTruthy();
  });

  it("C5: disambiguation is not auto-promoted even with complete demographics", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      isDisambiguationRequired: true,
      handoffPayload: null,
      memory: { goalSummary: "Crash diet", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "I want to crash diet and lose 10kg in 10 days",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
  });

  it("does not rewrite general_receptionist to health_coach just because demographics exist", () => {
    const raw = {
      intent: "general_wellness",
      targetAgent: "general_receptionist",
      status: "needs_info",
      handoffPayload: null,
      memory: { goalSummary: "Be healthy", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "i just want to be healthy",
      existingUserProfile: completeProfile
    });
    expect(out.targetAgent).toBe("general_receptionist");
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
  });
});
