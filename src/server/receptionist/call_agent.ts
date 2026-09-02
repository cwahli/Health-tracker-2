import { GoogleGenAI, Type } from "@google/genai";
import { buildReceptionistInstruction } from "./instruction.js";
import type {
  ReceptionistInputPayload,
  ReceptionistOutput,
  UserProfileSnapshot,
  UserMemory,
} from "./schema.js";

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

export const extractedBiomarkerLogSchema = {
  type: Type.OBJECT,
  properties: {
    biomarker: { type: Type.STRING },
    value: { type: Type.NUMBER },
    unit: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true },
  },
  required: ["biomarker", "value"],
};

export const receptionistOutputSchema = {
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
      properties: {},
    },
    memory: userMemorySchema,
    userResponse: { type: Type.STRING },
    isDisambiguationRequired: { type: Type.BOOLEAN, nullable: true },
    disambiguationContext: { type: Type.STRING, nullable: true },
    uiForm: uiFormSchema,
    handoffPayload: handoffPayloadSchema,
    newBiomarkerLogs: {
      type: Type.ARRAY,
      items: extractedBiomarkerLogSchema,
      nullable: true,
    },
    updatedProfile: {
      type: Type.OBJECT,
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

export async function callReceptionistAgent(
  ai: GoogleGenAI,
  payload: ReceptionistInputPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: ReceptionistOutput; raw: string; ms: number }> {
  const userText = formatReceptionistInput(payload);

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ text: userText }],
    config: {
      systemInstruction: buildReceptionistInstruction((payload as any).language || (payload.existingUserProfile as any)?.language),
      responseMimeType: "application/json",
      responseSchema: receptionistOutputSchema,
      temperature: 0.1,
    },
  });

  const durationMs = Date.now() - started;
  const rawText = response.text || "{}";
  let output: ReceptionistOutput;

  try {
    output = JSON.parse(rawText);
  } catch (err) {
    console.error("Failed to parse receptionist JSON:", rawText, err);
    output = {
      intent: "general_inquiry",
      targetAgent: "general_receptionist",
      status: "needs_info",
      missingFields: [],
      collectedData: {},
      memory: {
        goalSummary: "Inquiry received",
        userProfileSnapshot: payload.existingUserProfile || {},
        preferencesAndConstraints: {},
        conversationState: "onboarding_gather_info",
        pendingItems: [],
        keyInsights: [],
      },
      userResponse:
        "Hello! I am your Health Preparation Specialist. How can I help you today?",
      isDisambiguationRequired: false,
      disambiguationContext: null,
      uiForm: null,
      handoffPayload: null,
      newBiomarkerLogs: null,
      updatedProfile: null,
    };
  }

  // Strip rhetorical / filler "What should I do?" headers from userResponse
  if (output.userResponse && typeof output.userResponse === 'string') {
    output.userResponse = output.userResponse
      .replace(/(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?\s*What\s+(?:should\s+(?:I|you)\s+do|to\s+do\s+next)\??:?\s*(?:\*\*)?\s*(?=\n|$)/gi, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Preserve any known existing demographic fields if model omitted them
  if (payload.existingUserProfile && output.memory?.userProfileSnapshot) {
    const existing = payload.existingUserProfile;
    const snap = output.memory.userProfileSnapshot;
    (Object.keys(existing) as (keyof UserProfileSnapshot)[]).forEach((k) => {
      if (existing[k] !== undefined && existing[k] !== null && (snap[k] === undefined || snap[k] === null)) {
        (snap as any)[k] = existing[k];
      }
    });
  }

  // Synthesize updatedProfile object for easy consumption by LogChat
  if (!output.updatedProfile && output.memory?.userProfileSnapshot) {
    const snap = output.memory.userProfileSnapshot;
    const patch: Record<string, any> = {};
    if (snap.weightKg) patch.weight = snap.weightKg;
    if (snap.heightCm) patch.height = snap.heightCm;
    if (snap.age) patch.age = snap.age;
    if (snap.gender) patch.gender = snap.gender;
    if (snap.ethnicity) patch.ethnicity = snap.ethnicity;
    if (snap.bloodType) patch.bloodType = snap.bloodType;
    if (snap.activityLevel) patch.activityLevel = snap.activityLevel;
    if (snap.targetWeightKg) patch.targetWeight = snap.targetWeightKg;
    if (Object.keys(patch).length > 0) {
      output.updatedProfile = patch;
    }
  }

  // Synthesize uiForm if status is needs_info but model omitted uiForm
  if (
    output.status === "needs_info" &&
    (!output.uiForm || !output.uiForm.fields || output.uiForm.fields.length === 0) &&
    output.missingFields &&
    output.missingFields.length > 0
  ) {
    const fields: any[] = [];
    const fieldMapping: Record<
      string,
      { label: string; type: "text" | "number" | "select"; unit?: string; options?: string[] }
    > = {
      gender: { label: "Gender", type: "select", options: ["female", "male", "other"] },
      age: { label: "Age", type: "number", unit: "years" },
      height: { label: "Height", type: "number", unit: "cm" },
      heightcm: { label: "Height", type: "number", unit: "cm" },
      weight: { label: "Current Weight", type: "number", unit: "kg" },
      weightkg: { label: "Current Weight", type: "number", unit: "kg" },
      activitylevel: {
        label: "Activity Level",
        type: "select",
        options: ["sedentary", "light", "moderate", "very_active"],
      },
      medicalhistory: { label: "Medical History / Conditions", type: "text" },
      targetweight: { label: "Target Weight", type: "number", unit: "kg" },
      targetweightkg: { label: "Target Weight", type: "number", unit: "kg" },
    };

    output.missingFields.forEach((mf) => {
      const cleanKey = mf.toLowerCase().replace(/[^a-z0-9]/g, "");
      const matched = Object.entries(fieldMapping).find(
        ([k]) => k === cleanKey || cleanKey.includes(k) || k.includes(cleanKey)
      );
      if (matched) {
        fields.push({
          name: mf,
          label: matched[1].label,
          type: matched[1].type,
          unit: matched[1].unit,
          options: matched[1].options,
          required: true,
        });
      } else {
        fields.push({
          name: mf,
          label: mf.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          type: "text",
          required: true,
        });
      }
    });

    output.uiForm = {
      formId: `${output.intent || "onboarding"}_details_form`,
      title: "Complete Missing Details",
      description: "Provide the following information to tailor your health plan:",
      submitLabel: "Submit Details",
      fields,
    };
  }

  return { output, raw: rawText, ms: durationMs };
}
