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
    consolidatedUserProfile: userProfileSchema,
  },
  required: ["targetAgent", "intent", "summaryForAgent", "actionableInsights"],
  nullable: true,
};

export const modificationCommandSchema = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["update_biomarker", "remove_biomarker", "update_profile"],
    },
    keyName: { type: Type.STRING },
    newValue: { type: Type.STRING, nullable: true },
    oldValue: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true },
    unit: { type: Type.STRING, nullable: true },
    reason: { type: Type.STRING, nullable: true },
  },
  required: ["action", "keyName"],
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
        "onboarding_inquiry",
        "compare_meal",
        "literature_review",
        "test_planning",
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
        "food_compare",
        "agent7",
        "agent4",
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
    modificationCommand: {
      type: Type.ARRAY,
      items: modificationCommandSchema,
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

import {
  callReceptionistAgent as callServerReceptionistAgent,
  formatReceptionistInput as formatServerReceptionistInput,
} from "../../src/server/receptionist/call_agent.ts";

export function formatReceptionistInput(input: ReceptionistInputPayload): string {
  return formatServerReceptionistInput(input as any);
}

export async function callReceptionistAgent(
  ai: GoogleGenAI,
  input: ReceptionistInputPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: ReceptionistOutput; raw: string; ms: number }> {
  return callServerReceptionistAgent(ai, input as any, modelName);
}
