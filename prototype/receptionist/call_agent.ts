import { GoogleGenAI, Type } from "@google/genai";
import { buildReceptionistInstruction } from "./instruction.ts";
import type {
  ReceptionistInputPayload,
  ReceptionistOutput,
} from "./schema.ts";

export const userProfileSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, nullable: true },
    age: { type: Type.NUMBER, nullable: true },
    gender: { type: Type.STRING, nullable: true },
    ethnicity: { type: Type.STRING, nullable: true },
    bloodType: { type: Type.STRING, nullable: true },
    heightCm: { type: Type.NUMBER, nullable: true },
    weightKg: { type: Type.NUMBER, nullable: true },
    activityLevel: { type: Type.STRING, nullable: true },
    medicalHistory: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    dietaryPreferences: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    targetWeightKg: { type: Type.NUMBER, nullable: true },
  },
};

export const categorizedInsightsSchema = {
  type: Type.OBJECT,
  properties: {
    biometrics: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    lifestyle: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    clinicalNotes: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
  },
  nullable: true,
};

export const userMemorySchema = {
  type: Type.OBJECT,
  properties: {
    goalSummary: { type: Type.STRING },
    userProfileSnapshot: userProfileSchema,
    conversationState: {
      type: Type.STRING,
      enum: ["onboarding_gather_info", "ready_for_handoff", "ongoing_support"],
    },
    pendingItems: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    keyInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    categorizedInsights: categorizedInsightsSchema,
  },
  required: [
    "goalSummary",
    "userProfileSnapshot",
    "conversationState",
    "pendingItems",
    "keyInsights",
  ],
};

export const uiFormFieldSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    label: { type: Type.STRING },
    type: {
      type: Type.STRING,
      enum: ["text", "number", "select", "multiselect"],
    },
    options: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    unit: { type: Type.STRING, nullable: true },
    placeholder: { type: Type.STRING, nullable: true },
    required: { type: Type.BOOLEAN },
  },
  required: ["name", "label", "type", "required"],
};

export const uiFormSchema = {
  type: Type.OBJECT,
  properties: {
    formId: { type: Type.STRING },
    title: { type: Type.STRING },
    description: { type: Type.STRING, nullable: true },
    submitLabel: { type: Type.STRING, nullable: true },
    fields: {
      type: Type.ARRAY,
      items: uiFormFieldSchema,
    },
  },
  required: ["formId", "title", "fields"],
  nullable: true,
};

export const taskItemSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    category: {
      type: Type.STRING,
      enum: ["biomarkers", "nutrition", "fitness", "sleep", "general"],
    },
    title: { type: Type.STRING },
    status: {
      type: Type.STRING,
      enum: ["completed_on_track", "pending", "overdue", "inconsistent"],
    },
    priority: {
      type: Type.STRING,
      enum: ["low", "medium", "high"],
      nullable: true,
    },
    lastCompleted: { type: Type.STRING, nullable: true },
    details: { type: Type.STRING, nullable: true },
  },
  required: ["id", "category", "title", "status"],
};

export const handoffPayloadSchema = {
  type: Type.OBJECT,
  properties: {
    targetAgent: {
      type: Type.STRING,
      enum: [
        "health_coach",
        "medical",
        "biomarker_specialist",
        "biomarker_review",
        "coach",
        "nutritionist",
        "fitness_specialist",
        "general_receptionist",
      ],
    },
    intent: {
      type: Type.STRING,
      enum: [
        "weight_loss",
        "muscle_gain",
        "general_wellness",
        "health_improvement",
        "biomarker_review",
        "add_health_data",
        "profile_update",
        "meal_logging",
        "general_inquiry",
        "unknown",
      ],
    },
    summaryForAgent: { type: Type.STRING },
    actionableInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    recommendedTasks: {
      type: Type.ARRAY,
      items: taskItemSchema,
      nullable: true,
    },
  },
  required: [
    "targetAgent",
    "intent",
    "summaryForAgent",
    "actionableInsights",
  ],
};

export const receptionistResponseSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
        "weight_loss",
        "muscle_gain",
        "general_wellness",
        "health_improvement",
        "biomarker_review",
        "add_health_data",
        "profile_update",
        "meal_logging",
        "general_inquiry",
        "unknown",
      ],
    },
    targetAgent: {
      type: Type.STRING,
      enum: [
        "health_coach",
        "medical",
        "biomarker_specialist",
        "biomarker_review",
        "coach",
        "nutritionist",
        "fitness_specialist",
        "general_receptionist",
      ],
    },
    status: {
      type: Type.STRING,
      enum: ["needs_info", "ready_for_handoff"],
    },
    missingFields: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    collectedData: {
      type: Type.OBJECT,
      properties: {
        goal: { type: Type.STRING, nullable: true },
        notes: { type: Type.STRING, nullable: true },
      },
    },
    memory: userMemorySchema,
    userResponse: { type: Type.STRING },
    isDisambiguationRequired: { type: Type.BOOLEAN, nullable: true },
    disambiguationContext: { type: Type.STRING, nullable: true },
    uiForm: uiFormSchema,
    handoffPayload: {
      ...handoffPayloadSchema,
      nullable: true,
    },
  },
  required: [
    "intent",
    "targetAgent",
    "status",
    "missingFields",
    "memory",
    "userResponse",
  ],
};

export function formatReceptionistInput(input: ReceptionistInputPayload): string {
  const parts: string[] = [];

  parts.push("<user_turn>");
  parts.push(`Current Message: ${input.currentUserMessage}`);
  parts.push("</user_turn>");

  parts.push("\n<chat_history>");
  parts.push(JSON.stringify(input.chatHistory || [], null, 2));
  parts.push("</chat_history>");

  if (input.existingUserProfile) {
    parts.push("\n<existing_user_profile>");
    parts.push(JSON.stringify(input.existingUserProfile, null, 2));
    parts.push("</existing_user_profile>");
  } else {
    parts.push("\n<existing_user_profile>\nnull\n</existing_user_profile>");
  }

  if (input.existingMemory) {
    parts.push("\n<existing_memory>");
    parts.push(JSON.stringify(input.existingMemory, null, 2));
    parts.push("</existing_memory>");
  } else {
    parts.push("\n<existing_memory>\nnull\n</existing_memory>");
  }

  if (input.existingActivitiesAndTasks && input.existingActivitiesAndTasks.length > 0) {
    parts.push("\n<existing_activities_and_tasks>");
    parts.push(JSON.stringify(input.existingActivitiesAndTasks, null, 2));
    parts.push("</existing_activities_and_tasks>");
  }

  return parts.join("\n");
}

import { callReceptionistAgent as callServerReceptionistAgent } from "../../src/server/receptionist/call_agent.ts";

export async function callReceptionistAgent(
  ai: GoogleGenAI,
  input: ReceptionistInputPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: ReceptionistOutput; raw: string; ms: number }> {
  return callServerReceptionistAgent(ai, input, modelName);
}
