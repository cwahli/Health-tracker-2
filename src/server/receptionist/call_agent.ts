import { GoogleGenAI, Type } from "@google/genai";
import { buildReceptionistInstruction } from "./instruction.js";
import type {
  ReceptionistInputPayload,
  ReceptionistOutput,
  UserProfileSnapshot,
  UserMemory,
} from "./schema.js";
import {
  isUnderspecifiedUtterance,
  isRoutableSpecialistIntent,
  mapFrontDeskSpecialist,
} from "../../utils/frontDeskRouting.js";

export const userProfileSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, nullable: true },
    age: { type: Type.INTEGER, nullable: true },
    gender: { type: Type.STRING, nullable: true },
    ethnicity: { type: Type.STRING, nullable: true },
    bloodType: { type: Type.STRING, nullable: true },
    heightCm: { type: Type.INTEGER, nullable: true },
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

/** Repair truncated JSON string by closing unclosed strings, removing dangling keys, and balancing brackets/braces. */
export function repairTruncatedJson(raw: string): string {
  if (!raw || !raw.trim()) return "{}";
  let s = raw.trim();

  // Strip markdown code fences if present
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    JSON.parse(s);
    return s;
  } catch {
    // Needs structural repair
  }

  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "}" || char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === (char === "}" ? "}" : "]")) {
          stack.pop();
        }
      }
    }
  }

  if (inString) {
    s += '"';
  }

  // Remove unvalued property key at the end (e.g. `"key":` or `, "key":` or `,"key"`)
  s = s.replace(/(?:,\s*)?"[^"]*"\s*:\s*$/, "");
  // Remove trailing commas, colons, or whitespace
  s = s.replace(/[:,\s]+$/, "");

  // Append remaining closing brackets/braces
  while (stack.length > 0) {
    s += stack.pop();
  }

  return s;
}

/** Repair model JSON that emits runaway decimals or truncated structure so JSON.parse succeeds. */
export function sanitizeReceptionistJson(raw: string): string {
  if (!raw) return "{}";
  let s = raw.length > 200_000 ? raw.slice(0, 200_000) : raw;
  s = s.replace(/-?\d+\.\d{6,}/g, (m) => {
    const n = Number(m);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "null";
  });
  s = s.replace(/-?\d{12,}/g, (m) => {
    const n = Number(m);
    return Number.isFinite(n) ? String(n) : "null";
  });
  return repairTruncatedJson(s);
}

/**
 * Build the synthesized ready_for_handoff payload (shared by the
 * demographics-upgrade path and the contract-enforcement path below).
 */
export function synthesizeReadyHandoffPayload(output: any, snap: any, existing: any, detectedActivity?: string | null) {
  const age = snap.age || existing?.age || 40;
  const gender = snap.gender || existing?.gender || 'unknown';
  const height = snap.heightCm || existing?.heightCm || 165;
  const weight = snap.weightKg || existing?.weightKg || 65;
  const act = snap.activityLevel || existing?.activityLevel || detectedActivity || 'lightly_active';
  const intent = output.intent || 'general_inquiry';
  const goal = output.memory?.goalSummary || (intent === 'weight_loss' ? 'Weight management & metabolic health' : 'Health support');
  const insights =
    intent === 'weight_loss'
      ? ["Complete baseline profile collected.", "Ready for personalized caloric calculation and macro plan."]
      : intent === 'health_improvement'
        ? ["Complete baseline profile collected.", "Ready for a health-improvement review."]
        : ["Complete baseline profile collected."];
  return {
    targetAgent: output.targetAgent,
    intent,
    summaryForAgent: `User onboarding profile complete. Age: ${age}, Gender: ${gender}, Height: ${height}cm, Weight: ${weight}kg, Activity Level: ${act}. Goal: ${goal}.`,
    actionableInsights: insights,
    consolidatedUserProfile: {
      age: Number(age),
      gender: String(gender),
      heightCm: Number(height),
      weightKg: Number(weight),
      activityLevel: String(act),
      ...(existing || {}),
      ...snap
    },
    consolidatedMemory: output.memory
  };
}

export interface HandoffRepairContext {
  existingUserProfile?: any;
  detectedActivity?: string | null;
  currentUserMessage?: string;
}

/**
 * Enforce the handoff contract: `ready_for_handoff` MUST carry a usable
 * payload (targetAgent + summary) AND a non-empty user reply.
 *
 * Class repaired: HANDOFF_WITHOUT_PAYLOAD — the model sometimes emits
 * `ready_for_handoff` with a null payload and no reply (e.g. "I want to
 * loose weight" with an incomplete profile). The client then fired a blind
 * handoff with a generic prompt and the modal showed no answer.
 *
 * Repair: demographics complete → synthesize the payload; otherwise
 * downgrade to `needs_info` with the missing fields + a safe re-question
 * (the needs_info uiForm synthesizer downstream builds the form).
 */
function stayAtFrontDesk(output: any, missing: string[] = [], keepSpecialistTarget = false): any {
  output.status = 'needs_info';
  output.handoffPayload = null;
  output.missingFields = missing;
  if (!keepSpecialistTarget) output.targetAgent = 'general_receptionist';
  return output;
}

/**
 * Only promote needs_info → ready_for_handoff for a named specialist job
 * (C1b: weight_loss + complete demographics). Never rewrite
 * general_receptionist to health_coach just because the profile is filled.
 */
export function maybePromoteHandoff(output: any, ctx: HandoffRepairContext): any {
  if (!output || output.isDisambiguationRequired) return output;
  if (isUnderspecifiedUtterance(ctx.currentUserMessage)) return output;
  if (output.targetAgent === 'general_receptionist') return output;
  if (!isRoutableSpecialistIntent(output.intent, output.targetAgent)) return output;

  const specialist = mapFrontDeskSpecialist(output.targetAgent, output.intent);
  if (specialist !== 'health_baseline') return output;

  const snap = output.memory?.userProfileSnapshot || {};
  const existing = ctx.existingUserProfile || {};
  const hasCoreDemographics = Boolean(
    (snap.age || existing.age) &&
    (snap.gender || existing.gender) &&
    (snap.heightCm || existing.heightCm) &&
    (snap.weightKg || existing.weightKg) &&
    (snap.activityLevel || existing.activityLevel || ctx.detectedActivity)
  );
  if (!hasCoreDemographics) return output;

  if (output.status === 'needs_info' || !output.status || (output.status as string) === 'in_progress') {
    output.status = 'ready_for_handoff';
    output.targetAgent = output.targetAgent || 'health_coach';
    if (!output.handoffPayload) {
      output.handoffPayload = synthesizeReadyHandoffPayload(output, snap, existing, ctx.detectedActivity);
    }
    output.missingFields = [];
    output.uiForm = null;
    output.userResponse = output.userResponse || "Thank you! I have all your key details. I am now handing you over to your Health Coach to formulate your personalized plan.";
  }
  return output;
}

export function enforceReadyHandoffContract(output: any, ctx: HandoffRepairContext): any {
  if (!output || output.status !== 'ready_for_handoff') return output;
  const snap = output.memory?.userProfileSnapshot || {};
  const existing = ctx.existingUserProfile || {};
  const lang = existing?.language === 'id' ? 'id' : 'en';

  if (isUnderspecifiedUtterance(ctx.currentUserMessage) || output.targetAgent === 'general_receptionist') {
    return stayAtFrontDesk(output, []);
  }
  if (!isRoutableSpecialistIntent(output.intent, output.targetAgent) && !mapFrontDeskSpecialist(output.targetAgent, output.intent)) {
    return stayAtFrontDesk(output, []);
  }

  const hp = output.handoffPayload;
  const usable = hp && typeof hp === 'object' && hp.targetAgent && hp.targetAgent !== 'general_receptionist' && (hp.summaryForAgent || hp.userContextSummary);
  if (!usable) {
    const missing: string[] = [];
    const specialist = mapFrontDeskSpecialist(output.targetAgent, output.intent);
    if (specialist === 'health_baseline') {
      if (!(snap.age || existing.age)) missing.push('age');
      if (!(snap.gender || existing.gender)) missing.push('gender');
      if (!(snap.heightCm || existing.heightCm)) missing.push('height');
      if (!(snap.weightKg || existing.weightKg)) missing.push('weight');
      if (!(snap.activityLevel || existing.activityLevel || ctx.detectedActivity)) missing.push('activity_level');
    }
    if (missing.length === 0 && isRoutableSpecialistIntent(output.intent, output.targetAgent)) {
      output.handoffPayload = synthesizeReadyHandoffPayload(output, snap, existing, ctx.detectedActivity);
      output.missingFields = [];
      output.uiForm = null;
    } else {
      stayAtFrontDesk(output, missing, true);
      if (!output.userResponse || !String(output.userResponse).trim()) {
        const msg = String(ctx.currentUserMessage || '');
        const goal = String(output.memory?.goalSummary || '');
        const wantsWeight = /lose weight|loose weight|weight loss|turun.*berat|berat badan/i.test(`${msg} ${goal}`);
        output.userResponse = lang === 'id'
          ? (wantsWeight
            ? `Saya bisa membantu Anda menurunkan berat badan dengan aman. Agar rencananya tepat, saya masih membutuhkan: ${missing.join(', ')}. Boleh dibagikan?`
            : `Terima kasih! Agar bisa lanjut, saya masih membutuhkan: ${missing.join(', ')}.`)
          : (wantsWeight
            ? `I can help you lose weight safely. To build your plan I still need: ${missing.join(', ')}. Could you share them?`
            : `Thanks! To proceed I still need: ${missing.join(', ')}.`);
      }
      return output;
    }
  } else {
    output.missingFields = [];
    output.uiForm = null;
  }
  if (!output.userResponse || !String(output.userResponse).trim()) {
    const specialist = mapFrontDeskSpecialist(output.targetAgent, output.intent);
    output.userResponse = lang === 'id'
      ? (specialist === 'medical'
        ? 'Terima kasih! Saya teruskan ke spesialis medis.'
        : 'Terima kasih! Detail Anda sudah lengkap. Saya teruskan ke Health Coach untuk menyusun rencana personal Anda.')
      : (specialist === 'medical'
        ? 'Thank you! I am handing you over to the medical specialist.'
        : 'Thank you! I have all your key details. I am now handing you over to your Health Coach to formulate your personalized plan.');
  }
  return output;
}

export async function callReceptionistAgent(
  ai: GoogleGenAI,
  payload: ReceptionistInputPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: ReceptionistOutput; raw: string; ms: number; systemInstruction: string; userText: string }> {
  const userText = formatReceptionistInput(payload);
  const systemInstruction = buildReceptionistInstruction((payload as any).language || (payload.existingUserProfile as any)?.language);

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ text: userText }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: receptionistOutputSchema,
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - started;
  const rawText = sanitizeReceptionistJson(response.text || "{}");
  let output: ReceptionistOutput;

  try {
    output = JSON.parse(rawText);
  } catch (err) {
    const head = rawText.slice(0, 240).replace(/\s+/g, " ");
    console.error("Failed to parse receptionist JSON:", err instanceof Error ? err.message : err, "rawLen=", rawText.length, "head=", head);
    const msg = String(payload.currentUserMessage || "").toLowerCase();
    const wantsWeight = /lose weight|loose weight|weight loss/.test(msg);
    output = {
      intent: wantsWeight ? "weight_loss" : "general_inquiry",
      targetAgent: wantsWeight ? "health_coach" : "general_receptionist",
      status: "needs_info",
      missingFields: wantsWeight ? ["gender", "age", "height", "weight", "medical_history"] : [],
      collectedData: {},
      memory: {
        goalSummary: wantsWeight ? "User wants to lose weight." : "Inquiry received",
        userProfileSnapshot: payload.existingUserProfile || {},
        preferencesAndConstraints: {},
        conversationState: "onboarding_gather_info",
        pendingItems: wantsWeight ? ["gender", "age", "height", "weight"] : [],
        keyInsights: [],
      },
      userResponse: wantsWeight
        ? "I can help you lose weight safely. To build a calorie plan I need your gender, age, height, current weight, activity level, and any medical conditions."
        : "Hello! I am your Health Preparation Specialist. How can I help you today?",
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

  // Also preserve known demographic fields from existingMemory
  if (payload.existingMemory?.userProfileSnapshot && output.memory?.userProfileSnapshot) {
    const prevSnap = payload.existingMemory.userProfileSnapshot;
    const snap = output.memory.userProfileSnapshot;
    (Object.keys(prevSnap) as (keyof UserProfileSnapshot)[]).forEach((k) => {
      if (prevSnap[k] !== undefined && prevSnap[k] !== null && (snap[k] === undefined || snap[k] === null)) {
        (snap as any)[k] = prevSnap[k];
      }
    });
  }

  // Check if currentUserMessage contains activity level or if form submitted it
  const userMsg = String(payload.currentUserMessage || "").trim();
  const userMsgLower = userMsg.toLowerCase();
  let detectedActivity: string | null = null;
  if (/sedentary/i.test(userMsgLower)) detectedActivity = 'sedentary';
  else if (/lightly\s*active|light\s*exercise|\blight\b/i.test(userMsgLower)) detectedActivity = 'lightly_active';
  else if (/moderately\s*active|moderate\s*exercise|\bmoderate\b/i.test(userMsgLower)) detectedActivity = 'moderately_active';
  else if (/very\s*active|heavy\s*exercise|\bintense\b|\bvery\b/i.test(userMsgLower)) detectedActivity = 'very_active';
  else if (/extra\s*active|\bathlete\b/i.test(userMsgLower)) detectedActivity = 'extra_active';

  if (detectedActivity && output.memory?.userProfileSnapshot) {
    output.memory.userProfileSnapshot.activityLevel = detectedActivity as any;
    if (output.collectedData) {
      output.collectedData.activityLevel = detectedActivity;
    }
    if (Array.isArray(output.missingFields)) {
      output.missingFields = output.missingFields.filter(f => !/activity/i.test(f));
    }
    if (Array.isArray(output.memory?.pendingItems)) {
      output.memory.pendingItems = output.memory.pendingItems.filter(p => !/activity/i.test(p));
    }
  }

  output = maybePromoteHandoff(output, {
    existingUserProfile: payload.existingUserProfile,
    detectedActivity,
    currentUserMessage: payload.currentUserMessage
  });

  output = enforceReadyHandoffContract(output, {
    existingUserProfile: payload.existingUserProfile,
    detectedActivity,
    currentUserMessage: payload.currentUserMessage
  });

  // Preserve all known demographic fields into handoffPayload.consolidatedUserProfile
  if (output.handoffPayload) {
    const existing = payload.existingUserProfile || {};
    const currentSnap = output.memory?.userProfileSnapshot || {};
    if (!output.handoffPayload.consolidatedUserProfile) {
      output.handoffPayload.consolidatedUserProfile = { ...existing, ...currentSnap };
    } else {
      const cup = output.handoffPayload.consolidatedUserProfile;
      const combined = { ...existing, ...currentSnap };
      (Object.keys(combined) as (keyof UserProfileSnapshot)[]).forEach((k) => {
        if (combined[k] !== undefined && combined[k] !== null && (cup[k] === undefined || cup[k] === null)) {
          (cup as any)[k] = combined[k];
        }
      });
    }
    if (!output.handoffPayload.consolidatedMemory && output.memory) {
      output.handoffPayload.consolidatedMemory = output.memory;
    }
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

  return { output, raw: rawText, ms: durationMs, systemInstruction, userText };
}
