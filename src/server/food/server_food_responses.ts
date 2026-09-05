/**
 * F-8.10 shard 26 — mode response payloads, extracted verbatim from
 * runFoodAnalyze. Pure res.json body shaping; routing, streaming, and the
 * res.json calls themselves stay in the pipeline.
 */

export function buildDiscussionResponse(args: {
  rawParsed: any;
  fullPromptSent: string;
  apiCalls: any;
}): Record<string, any> {
  const { rawParsed, fullPromptSent, apiCalls } = args;
  return {
    mode: "discussion",
    dietitianScratchpad: rawParsed._internalReasoning,
    text: rawParsed.message || "Here is the details on this meal composition.",
    message: rawParsed.message || "Here is the details on this meal composition.",
    data: null,
    agentPrompt: fullPromptSent,
    apiCalls
  };
}

export function buildEvaluationResponse(args: {
  rawParsed: any;
  scoutInternalReasoning: any;
  rawScoutData: any;
  comparisonData: any;
  comparisonSet: any;
  scoutItems: any;
  scoutContentType: any;
  diningEnvironment: any;
  fullPromptSent: string;
  apiCalls: any;
}): Record<string, any> {
  const {
    rawParsed, scoutInternalReasoning, rawScoutData, comparisonData, comparisonSet,
    scoutItems, scoutContentType, diningEnvironment, fullPromptSent, apiCalls,
  } = args;
  return {
    mode: "evaluation",
    dietitianScratchpad: rawParsed._internalReasoning,
    scoutInternalReasoning,
    rawScout: rawScoutData,
    comparison: comparisonData,
    comparisonSet,
    scoutItems,
    scoutContentType,
    diningEnvironment,
    agentPrompt: fullPromptSent,
    message: rawParsed.message,
    text: rawParsed.message,
    apiCalls
  };
}

export function buildNewLogResponse(args: {
  rawParsed: any;
  parsedData: any;
  pendingFoodLog: any;
  mealBuild: any;
  gate: any;
  scoutInternalReasoning: any;
  rawScoutData: any;
  scoutContentType: any;
  diningEnvironment: any;
  fullPromptSent: string;
  scoutItems: any;
  apiCalls: any;
}): Record<string, any> {
  const {
    rawParsed, parsedData, pendingFoodLog, mealBuild, gate, scoutInternalReasoning,
    rawScoutData, scoutContentType, diningEnvironment, fullPromptSent, scoutItems, apiCalls,
  } = args;
  return {
    mode: "new_log",
    dietitianScratchpad: rawParsed._internalReasoning,
    scoutInternalReasoning,
    rawScout: rawScoutData,
    scoutContentType,
    diningEnvironment,
    text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
    message: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
    data: pendingFoodLog || parsedData,
    pendingFoodLog: pendingFoodLog || parsedData,
    mealBuild,
    savable: gate.savable,
    gate,
    agentPrompt: fullPromptSent,
    scoutItems,
    apiCalls
  };
}

export function buildModifyNoMealResponse(args: {
  rawParsed: any;
  apiCalls: any;
}): Record<string, any> {
  const { rawParsed, apiCalls } = args;
  return {
    text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
    message: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
    data: null,
    apiCalls
  };
}

export function buildModifyResponse(args: {
  rawParsed: any;
  finalMessage: string;
  pendingFoodLog: any;
  activeMeal: any;
  mealBuild: any;
  gate: any;
  editApplied: boolean;
  fullPromptSent: string;
  scoutItems: any;
  apiCalls: any;
}): Record<string, any> {
  const {
    rawParsed, finalMessage, pendingFoodLog, activeMeal, mealBuild, gate,
    editApplied, fullPromptSent, scoutItems, apiCalls,
  } = args;
  return {
    mode: "modify",
    dietitianScratchpad: rawParsed._internalReasoning,
    text: finalMessage,
    message: finalMessage,
    data: pendingFoodLog || activeMeal,
    pendingFoodLog: pendingFoodLog || activeMeal,
    mealBuild,
    savable: gate.savable,
    gate,
    editApplied,
    agentPrompt: fullPromptSent,
    scoutItems,
    apiCalls
  };
}

export function buildDegradeResponse(args: {
  payloadData: any;
  degradedMeal: any;
  visionScoutItems: any;
  scoutContentType: any;
  fullPromptSent: string;
  apiCalls: any;
}): Record<string, any> {
  const {
    payloadData, degradedMeal, visionScoutItems, scoutContentType, fullPromptSent, apiCalls,
  } = args;
  const degradeMessage = "Nutrients logged based on core databases, but AI clinical advice is currently unavailable.";
  return {
    mode: "new_log",
    data: payloadData,
    pendingFoodLog: payloadData,
    mealBuild: degradedMeal,
    degradedStages: degradedMeal.degradedStages,
    scoutItems: visionScoutItems,
    scoutContentType,
    text: degradeMessage,
    message: degradeMessage,
    agentPrompt: fullPromptSent,
    apiCalls
  };
}
