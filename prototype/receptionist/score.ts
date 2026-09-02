import type { BenchmarkCase, ReceptionistOutput } from "./schema.ts";

export interface CaseScoreResult {
  caseId: string;
  passed: boolean;
  score: number; // 0 to 100
  checks: {
    name: string;
    passed: boolean;
    details: string;
  }[];
}

export function scoreReceptionistCase(
  benchmark: BenchmarkCase,
  actual: ReceptionistOutput
): CaseScoreResult {
  const checks: { name: string; passed: boolean; details: string }[] = [];
  const expected = benchmark.expectedOutput;

  // 1. Intent Match
  const isIntentAlias = (a: string, b: string) => {
    if (a === b) return true;
    const bioGroup = ["biomarker_review", "add_health_data", "health_improvement", "profile_update"];
    if (bioGroup.includes(a) && bioGroup.includes(b)) return true;
    const wellnessGroup = ["general_wellness", "health_improvement", "wellness"];
    if (wellnessGroup.includes(a) && wellnessGroup.includes(b)) return true;
    return false;
  };
  const intentPassed = actual.intent === expected.intent || isIntentAlias(actual.intent, expected.intent);
  checks.push({
    name: "Intent Identification",
    passed: intentPassed,
    details: `Expected: ${expected.intent}, Actual: ${actual.intent}`,
  });

  // 2. Target Agent Match
  const isAgentAlias = (a: string, b: string) => {
    if (a === b) return true;
    if ((a === "health_coach" || a === "coach") && (b === "health_coach" || b === "coach")) return true;
    const medGroup = ["medical", "biomarker_specialist", "biomarker_review", "general_receptionist"];
    if (medGroup.includes(a) && medGroup.includes(b)) return true;
    return false;
  };
  const agentPassed =
    actual.targetAgent === expected.targetAgent ||
    isAgentAlias(actual.targetAgent, expected.targetAgent);
  checks.push({
    name: "Target Agent Routing",
    passed: agentPassed,
    details: `Expected: ${expected.targetAgent}, Actual: ${actual.targetAgent}`,
  });

  // 3. Status Match
  const statusPassed = actual.status === expected.status;
  checks.push({
    name: "Receptionist Status",
    passed: statusPassed,
    details: `Expected: ${expected.status}, Actual: ${actual.status}`,
  });

  // 4. Missing Fields Evaluation
  if (expected.status === "needs_info") {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const actualMissingNorm = (actual.missingFields || []).map(normalize);
    const matchedFields = expected.expectedMissingFields.filter((expField) => {
      const expNorm = normalize(expField);
      return actualMissingNorm.some(
        (actNorm) => actNorm.includes(expNorm) || expNorm.includes(actNorm)
      );
    });
    const ratio =
      expected.expectedMissingFields.length > 0
        ? matchedFields.length / expected.expectedMissingFields.length
        : 1;
    const missingPassed = ratio >= 0.6; // at least 60% overlap
    checks.push({
      name: "Missing Fields Identification",
      passed: missingPassed,
      details: `Matched ${matchedFields.length}/${expected.expectedMissingFields.length} expected fields (${matchedFields.join(", ")})`,
    });
  } else {
    const missingPassed = (actual.missingFields || []).length === 0;
    checks.push({
      name: "Missing Fields Empty When Ready",
      passed: missingPassed,
      details: `Missing fields count: ${(actual.missingFields || []).length}`,
    });
  }

  // 5. Memory Validation
  const memory = actual.memory;
  const statePassed =
    !expected.memoryValidation.stateEquals ||
    memory?.conversationState === expected.memoryValidation.stateEquals ||
    (actual.isDisambiguationRequired && memory?.conversationState === "onboarding_gather_info");
  checks.push({
    name: "Memory Conversation State",
    passed: Boolean(statePassed),
    details: `Expected: ${expected.memoryValidation.stateEquals}, Actual: ${memory?.conversationState}`,
  });

  const goalSummaryText = (memory?.goalSummary || "").toLowerCase();
  const summaryMatches = (
    expected.memoryValidation.goalSummaryIncludes || []
  ).filter((kw) => goalSummaryText.includes(kw.toLowerCase()));
  const summaryPassed =
    (expected.memoryValidation.goalSummaryIncludes || []).length === 0 ||
    summaryMatches.length > 0;
  checks.push({
    name: "Memory Goal Summary Accuracy",
    passed: summaryPassed,
    details: `Summary: "${memory?.goalSummary || ""}", Matched keywords: ${summaryMatches.join(", ")}`,
  });

  if (expected.memoryValidation.userProfileSnapshotCheck) {
    const expSnap = expected.memoryValidation.userProfileSnapshotCheck;
    const actSnap = (memory?.userProfileSnapshot || {}) as Record<string, any>;
    const snapKeys = Object.keys(expSnap);
    let matchedSnap = 0;
    const snapDetails: string[] = [];

    for (const k of snapKeys) {
      const expVal = expSnap[k];
      const actVal = actSnap[k];
      let ok = false;
      if (typeof expVal === "string" && typeof actVal === "string") {
        ok =
          actVal.toLowerCase().includes(expVal.toLowerCase()) ||
          expVal.toLowerCase().includes(actVal.toLowerCase());
      } else if (typeof expVal === "number") {
        ok = Number(actVal) === Number(expVal);
      } else {
        ok = Boolean(actVal);
      }
      if (ok) matchedSnap++;
      snapDetails.push(`${k}: ${actVal} (exp: ${expVal})`);
    }

    const snapPassed = matchedSnap === snapKeys.length;
    checks.push({
      name: "User Profile Snapshot Extraction",
      passed: snapPassed,
      details: `Matched ${matchedSnap}/${snapKeys.length} fields (${snapDetails.join(", ")})`,
    });
  }

  // 6. UI Form Issuance Validation
  if (expected.status === "needs_info") {
    const hasForm = Boolean(
      actual.uiForm &&
        actual.uiForm.fields &&
        Array.isArray(actual.uiForm.fields) &&
        actual.uiForm.fields.length > 0
    );
    const formPassed = expected.expectsUiForm === false ? true : hasForm;
    checks.push({
      name: "Interactive UI Form Issuance",
      passed: formPassed,
      details: hasForm
        ? `Issued form '${actual.uiForm?.title}' with ${actual.uiForm?.fields.length} interactive fields (${actual.uiForm?.fields.map((f: any) => f.name).join(", ")})`
        : `Form issued: false (Expected interactive widget for missing fields)`,
    });
  }

  // 7. Goal Disambiguation Check
  if (expected.isDisambiguationRequired !== undefined) {
    const disPassed = Boolean(actual.isDisambiguationRequired) === expected.isDisambiguationRequired;
    checks.push({
      name: "Goal Disambiguation & Conflict Flagging",
      passed: disPassed,
      details: `Expected: ${expected.isDisambiguationRequired}, Actual: ${Boolean(actual.isDisambiguationRequired)} (Context: "${actual.disambiguationContext || "none"}")`,
    });
  }

  // 8. Handoff Validation
  if (expected.handoffValidation) {
    if (expected.handoffValidation.hasPayload) {
      const isCoachOrMedAlias = (a?: string, b?: string) => {
        if (!a || !b) return false;
        if (a === b) return true;
        if ((a === "health_coach" || a === "coach") && (b === "health_coach" || b === "coach")) return true;
        const medGroup = ["medical", "biomarker_specialist", "biomarker_review"];
        if (medGroup.includes(a) && medGroup.includes(b)) return true;
        return false;
      };
      const targetMatches =
        actual.handoffPayload &&
        (actual.handoffPayload.targetAgent === expected.targetAgent ||
          isCoachOrMedAlias(actual.handoffPayload.targetAgent, expected.targetAgent));
      const hasPayloadPassed =
        actual.handoffPayload !== null &&
        actual.handoffPayload !== undefined &&
        Boolean(targetMatches);
      checks.push({
        name: "Handoff Payload Generated",
        passed: hasPayloadPassed,
        details: `Payload present: ${Boolean(actual.handoffPayload)}, Target: ${actual.handoffPayload?.targetAgent}`,
      });
    } else {
      const noPayloadPassed =
        actual.handoffPayload === null || actual.handoffPayload === undefined;
      checks.push({
        name: "Handoff Payload Withheld When Incomplete",
        passed: noPayloadPassed,
        details: `Payload is null: ${noPayloadPassed}`,
      });
    }
  }

  // 9. Conversational Response Check
  const responseText = (actual.userResponse || "").toLowerCase();
  const requiredKeywords = expected.mustIncludeInResponse || [];
  const foundKeywords = requiredKeywords.filter((kw) =>
    responseText.includes(kw.toLowerCase())
  );
  const responsePassed =
    requiredKeywords.length === 0 ||
    foundKeywords.length >= Math.ceil(requiredKeywords.length * 0.5);
  checks.push({
    name: "User Response Relevance",
    passed: responsePassed,
    details: `Matched ${foundKeywords.length}/${requiredKeywords.length} response keywords (${foundKeywords.join(", ")})`,
  });

  const passedChecksCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedChecksCount / checks.length) * 100);
  const overallPassed = passedChecksCount === checks.length;

  return {
    caseId: benchmark.id,
    passed: overallPassed,
    score,
    checks,
  };
}

export function scoreCoachOutput(output: any, payload?: any): CaseScoreResult {
  const checks: { name: string; passed: boolean; details: string }[] = [];

  const report = output?.report;

  // 1. Report Root Schema
  const hasReport = Boolean(
    report &&
      typeof report.timelineToOptimal === "string" &&
      Array.isArray(report.riskCategories) &&
      Array.isArray(report.topNutrientTargets) &&
      typeof report.generalNutrientTargets === "object"
  );
  checks.push({
    name: "Health Baseline Report Schema",
    passed: hasReport,
    details: `Report present: ${hasReport}, Categories: ${report?.riskCategories?.length || 0}`,
  });

  // 2. Timeline to Optimal Prognosis
  const timelineValid = Boolean(
    report &&
      report.timelineToOptimal &&
      report.timelineToOptimal.length >= 10
  );
  checks.push({
    name: "Timeline to Optimal Prognosis",
    passed: timelineValid,
    details: `Timeline: "${(report?.timelineToOptimal || "").substring(0, 60)}..."`,
  });

  // 3. Top Core Nutrient Targets (Top 3-6)
  const topTargets = report?.topNutrientTargets || [];
  const topTargetsValid = topTargets.length >= 2 && topTargets.length <= 8;
  checks.push({
    name: "Top Core Nutrient Targets",
    passed: topTargetsValid,
    details: `Generated ${topTargets.length} top targets: ${topTargets.map((t: any) => `${t.nutrientKey} (${t.targetValue})`).join(", ")}`,
  });

  // 4. General 31-Nutrient Mechanism
  const genMap = report?.generalNutrientTargets || {};
  const REQUIRED_31 = [
    "calories",
    "totalFat",
    "solubleFibre",
    "saturatedFat",
    "protein",
    "potassium",
    "transFat",
    "addedSugar",
    "carbohydrates",
    "totalFibre",
    "sodium",
    "unsaturatedFat",
    "omega3",
    "magnesium",
    "calcium",
    "iron",
    "zinc",
    "selenium",
    "iodine",
    "phosphorus",
    "vitaminD",
    "vitaminB12",
    "folate",
    "vitaminC",
    "vitaminE",
    "vitaminK",
    "vitaminA",
    "vitaminB6",
    "thiamine",
    "riboflavin",
    "niacin",
  ];
  const populatedKeys = REQUIRED_31.filter((k) => Boolean(genMap[k]));
  const genValid = populatedKeys.length >= 28;
  checks.push({
    name: "31-Nutrient Target Population",
    passed: genValid,
    details: `Populated ${populatedKeys.length}/31 nutrients (e.g. Calories: ${genMap.calories}, Protein: ${genMap.protein})`,
  });

  // 5. Risk Categories & Daily Activities
  const categories = report?.riskCategories || [];
  const hasActivities = categories.some(
    (c: any) => Array.isArray(c.dailyActivities) && c.dailyActivities.length > 0
  );
  checks.push({
    name: "Risk Categories & Daily Activities",
    passed: categories.length > 0 && hasActivities,
    details: `Categories: ${categories.length}, hasDailyActivities: ${hasActivities}`,
  });

  const allPassed = checks.every((c) => c.passed);
  const score = Math.round(
    (checks.filter((c) => c.passed).length / checks.length) * 100
  );

  return {
    passed: allPassed,
    score,
    checks,
  };
}

export function scoreMedicalOutput(medicalOutput: any): {
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; details: string }>;
} {
  const checks: Array<{ name: string; passed: boolean; details: string }> = [];

  const data = medicalOutput?.extractedData || [];
  checks.push({
    name: "Extracted Biomarkers Array Presence",
    passed: Array.isArray(data) && data.length > 0,
    details: `Extracted ${data.length} biomarker items.`,
  });

  const hasCoreLipidOrMetabolic = data.some((d: any) => {
    const k = (d.biomarker || "").toLowerCase();
    return k.includes("cholesterol") || k.includes("glucose") || k.includes("triglyceride") || k.includes("alt") || k.includes("ast");
  });
  checks.push({
    name: "Core Biomarker Terminology Mapping",
    passed: hasCoreLipidOrMetabolic,
    details: `Extracted keys: ${data.map((d: any) => d.biomarker).slice(0, 6).join(", ")}...`,
  });

  const hasNumericUnits = data.some((d: any) => Boolean(d.numeric_value !== null && d.unit));
  checks.push({
    name: "Lossless Numeric & Unit Preservation",
    passed: hasNumericUnits,
    details: `Sample values: ${data.slice(0, 3).map((d: any) => `${d.biomarker}: ${d.numeric_value} ${d.unit}`).join("; ")}`,
  });

  const hasExplanationOrText = Boolean(medicalOutput?.text && medicalOutput.text.length > 10);
  checks.push({
    name: "Clinical Confirmation & Guidance",
    passed: hasExplanationOrText,
    details: `Text: "${(medicalOutput?.text || "").slice(0, 80)}..."`,
  });

  const allPassed = checks.every((c) => c.passed);
  const score = Math.round(
    (checks.filter((c) => c.passed).length / checks.length) * 100
  );

  return {
    passed: allPassed,
    score,
    checks,
  };
}
