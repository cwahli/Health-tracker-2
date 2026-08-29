export function formatPatientContext(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  foodLogs?: any[];
  userProfile?: any;
}) {
  const { biomarkersNeedingImprovement, remainingAllowance, foodLogs, userProfile } = context;

  const formattedBiomarkers = Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0
    ? biomarkersNeedingImprovement.map((b: any) => {
        if (typeof b === "string") {
          return `• ${b}`;
        }
        if (b && typeof b === "object" && b.name) {
          const statusStr = b.status ? ` is ${String(b.status).toUpperCase()}` : "";
          const valStr = b.value !== undefined ? ` (${b.value} ${b.unit || ""}, normal range: ${b.normalRange || ""})` : "";
          return `• ${b.name}${statusStr}${valStr}`;
        }
        return `• ${String(b)}`;
      }).join("\n")
    : "• None";

  const biomarkersList = formattedBiomarkers;

  // Timezone helper
  const getCurrentDateInTimezone = (timezone?: string): string => {
    try {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      };
      const formatter = new Intl.DateTimeFormat('en-CA', options);
      return formatter.format(new Date());
    } catch (e) {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  };

  const timezone = userProfile?.timezone || 'UTC';
  const todayStr = getCurrentDateInTimezone(timezone);

  // Initialize nutrient tracking
  const topNutrients = [
    { key: 'saturatedFat', targetKey: 'saturatedFatTarget', label: 'Sat fat', unit: 'g', defaultTarget: 12 },
    { key: 'calories', targetKey: 'caloriesTarget', label: 'Calorie', unit: 'kcal', defaultTarget: 1321 },
    { key: 'sodium', targetKey: 'sodiumTarget', label: 'Sodium', unit: 'mg', defaultTarget: 960 },
    { key: 'protein', targetKey: 'proteinTarget', label: 'Protein', unit: 'g', defaultTarget: 72 },
    { key: 'carbohydrates', targetKey: 'carbohydratesTarget', label: 'Carbohydrates', unit: 'g', defaultTarget: 128 },
    { key: 'totalFibre', altKey: 'solubleFibre', targetKey: 'solubleFibreTarget', label: 'Total Fibre', unit: 'g', defaultTarget: 38 },
    { key: 'potassium', targetKey: 'potassiumTarget', label: 'Potassium', unit: 'mg', defaultTarget: 4200 },
    { key: 'solubleFibre', targetKey: 'solubleFibreTarget', label: 'Soluble Fibre', unit: 'g', defaultTarget: 12 },
    { key: 'addedSugar', targetKey: 'addedSugarTarget', label: 'Added Sugar', unit: 'g', defaultTarget: 24 },
    // NOTE: 'sugar' (Total Sugar) is intentionally NOT tracked here as a limited target.
    // Whole fruit/veg/dairy naturally contain sugar with no clinical daily cap; only
    // Added Sugar has a meaningful limit. See clinical framing note below.
    { key: 'transFat', targetKey: 'transFatTarget', label: 'Trans Fat', unit: 'g', defaultTarget: 0 },
  ];

  const getTarget = (key: string, defaultTarget: number) => {

    if (remainingAllowance) {
      if (remainingAllowance[key] !== undefined) return Math.round(Number(remainingAllowance[key]));
    }
    return defaultTarget;
  };

  // Compute actual 7-day averages and today's totals from foodLogs if present
  let averages: Record<string, number> = {};
  let todaysTotals: Record<string, number> = {};
  let hasDynamicData = false;

  if (Array.isArray(foodLogs) && foodLogs.length > 0) {
    hasDynamicData = true;

    // Last 7 days including today
    const last7Days: string[] = [];
    const parts = todayStr.split('-');
    const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayDate);
      d.setDate(todayDate.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      last7Days.push(`${y}-${m}-${day}`);
    }

    // Today's logged total
    const todaysFoods = foodLogs.filter(f => f.date === todayStr);
    todaysFoods.forEach(f => {
      if (f.nutrients) {
        Object.keys(f.nutrients).forEach(k => {
          todaysTotals[k] = (todaysTotals[k] || 0) + (Number(f.nutrients[k]) || 0);
        });
      }
    });

    // 7-day averages
    topNutrients.forEach((n) => {
      const nutrientKey = n.key;
      let total = 0;
      last7Days.forEach(dStr => {
        const dayFoods = foodLogs.filter(f => f.date === dStr);
        const daySum = dayFoods.reduce((acc, curr) => {
          return acc + (Number(curr.nutrients?.[nutrientKey] || (n.altKey ? curr.nutrients?.[n.altKey] : 0)) || 0);
        }, 0);
        total += daySum;
      });
      averages[nutrientKey] = total / 7;
    });
  }

  let targetLimits = "=== NUTRITIONAL TARGET STATUS ===\n";

  if (hasDynamicData) {
    // 7 days avg line
    const avgParts: string[] = [];
    topNutrients.forEach((n) => {
      const avgVal = Math.round(averages[n.key] || 0);
      const targetVal = Math.round(getTarget(n.targetKey, n.defaultTarget));
      if (avgVal > targetVal && targetVal > 0) {
        const pctOver = Math.round(((avgVal - targetVal) / targetVal) * 100);
        avgParts.push(`${n.label} (${avgVal}${n.unit} - ${pctOver}% over)`);
      } else if (avgVal > 0) {
        avgParts.push(`${n.label} (${avgVal}${n.unit} avg)`);
      } else {
        avgParts.push(`${n.label} (0${n.unit} avg)`);
      }
    });

    const avgLine = `7 days avg: ${avgParts.join(', ')}`;

    // Todays target line
    const todayParts: string[] = [];
    topNutrients.forEach((n) => {
      const logged = Math.round(todaysTotals[n.key] || 0);
      const targetVal = Math.round(getTarget(n.targetKey, n.defaultTarget));

      if (targetVal > 0 && logged > targetVal) {
        const overage = logged - targetVal;
        const pctOver = Math.round((overage / targetVal) * 100);
        todayParts.push(`${n.label} (${logged}${n.unit} over ${targetVal}${n.unit}, ${pctOver}% over daily limit)`);
      } else if (targetVal > 0) {
        todayParts.push(`${n.label} (${logged}/${targetVal}${n.unit})`);
      } else {
        todayParts.push(`${logged}${n.unit}`);
      }
    });

    const todayLine = `Todays target: ${todayParts.join(', ')}`;
    targetLimits += `${avgLine}\n${todayLine}`;
  } else {
    // No dynamic food-log data was supplied for this request (new user, or this call
    // path didn't attach foodLogs). Previously this showed a fully fictional "already
    // over your limit" example dataset as if it were the user's real status — the
    // Dietitian LLM would then treat those fake numbers as ground truth for its
    // pre-calculated-percentage math, producing wildly wrong overage percentages for a
    // real meal. Show an honest empty state instead: real targets, zero logged so far.
    const emptyStateParts: string[] = topNutrients.map((n) => {
      const targetVal = Math.round(getTarget(n.targetKey, n.defaultTarget));
      return targetVal > 0 ? `${n.label} (0/${targetVal}${n.unit})` : `${n.label} (0${n.unit})`;
    });
    targetLimits += `No 7-day history available yet.\nTodays target: ${emptyStateParts.join(', ')}`;
  }

  return { biomarkersList, targetLimits };
}

export const DIETITIAN_CORE_DIRECTIVES = `
You are a Dietician coach operating within a personalized health application. Provide direct, practical nutritional guidance as a raw JSON object without markdown wrappers.

=== GENERAL RULES ===
- Do not recite raw macro lists. Focus next steps on practical real-food habits or movement (not future gram targets).
- Distinguish Total Sugar (naturally occurring in fruit/dairy) from Added Sugar (24g/day guideline). Never flag whole fruit or plain dairy as a sugar concern.

=== CLINICAL NUTRIENT AUDIT ===
- Audit each item's baseline nutrients and portion weights against culinary reality. If adjusting an inaccurate baseline (e.g. oil absorption, sodium, or starchy filler), provide 'correctedNutrients' and 'clinicalCorrectionNote'. Leave null only if baseline accurately reflects culinary reality.
- All numbers cited in '_internalReasoning' and 'message' MUST strictly match the authoritative numbers in === BACKEND PRE-CALCULATED ITEM NUTRIENTS (Absolute Truth) === and macroTotals. Do not invent or estimate alternative macro/micronutrient totals in your reasoning.

=== VERDICT LABEL GUIDELINES (3-6 WORDS MAX) ===
- Positive/Neutral: Core physiological health outcome (e.g. "Good for your heart", "Boosts lean muscle tissue", "Supports digestive balance").
- Overage/Risk: Metric-backed impact label (e.g. "140% over sat fat limit", "115% over sodium limit").
- STRICTLY BANNED: Food or meal descriptions (e.g. NEVER output "Exceptional High Protein Meal", "Exceptional lean protein asset", "High Protein Dish", "Nutrient Dense Meal", "Low Calorie Dinner"). The verdict label MUST state the biological health benefit/outcome or metric impact, NEVER describe the food/meal entity.
- BANNED: Vague descriptive sentences like "Elevates saturated fat and sodium limits".

=== MESSAGE NARRATIVE GUIDELINES (35-70 WORDS IN 4 BEATS - MODE B) ===
- STRICTLY BANNED: Do NOT copy your '_internalReasoning' into the 'message' field. The message MUST address the user in the second person (e.g. "You got..."), while reasoning is your private third-person planning space (e.g. "The user logged... I will...").
Write "message" strictly in 4 beats (Constructive, Comforting, No Shame):
- Beat 1 (Asset & Metric): Praise key nutrient asset with concrete metrics (e.g. "You got 53g of quality protein and healthy omega-3s from the salmon.").
- Beat 2 (Contextual Impact & Metric): Frame higher-density items constructively using pre-calculated percentages from NUTRITIONAL TARGET STATUS without alarmist language (e.g. "The cheesy pasta contributes 18g of saturated fat, bringing today's total to 140% of your target.").
- Beat 3 (Physiological Balance): Explain bodily balance and digestion constructively (e.g. "Pairing richer dishes with lighter, fiber-dense sides helps steady your digestion and supports sustained metabolic energy.").
- Beat 4 (Actionable Next Step): Direct practical habit or movement (e.g. "Enjoy a gentle 20-minute post-meal walk to support circulation, and balance your next meal with colorful greens or lentils.").

=== FULLY COMPLIANT FEW-SHOT EXAMPLE ===
{
  "_internalReasoning": "The user logged grilled salmon, macaroni and cheese, avocado, and lettuce. The salmon provides lean protein and omega-3s, while mac and cheese adds saturated fat (140% of daily target). In Mode B, I praise the protein asset, frame the rich side constructively without shame, explain digestion balance, and suggest a gentle walk and fiber-rich next meal.",
  "verdict": {
    "label": "140% over sat fat limit",
    "level": "alert"
  },
  "message": "You got 53g of quality protein and healthy omega-3s from the salmon. The cheesy pasta contributes 18g of saturated fat, bringing today's total to 140% of your target. Pairing richer dishes with lighter, fiber-dense sides helps steady your digestion and supports sustained metabolic energy. Enjoy a gentle 20-minute post-meal walk to support circulation, and balance your next meal with colorful greens or lentils.",
  "foodData": {
    "date": "2026-08-03",
    "name": "Grilled Salmon with Macaroni and Cheese, Avocado, and Lettuce",
    "itemsBreakdown": [
      {
        "scoutIndex": 0,
        "canonicalDbName": "Macaroni and Cheese, frozen entree",
        "weightGrams": 220,
        "foodType": "prepared dish/entree",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 1,
        "canonicalDbName": "Fish, salmon, Atlantic, farmed, cooked, dry heat",
        "weightGrams": 150,
        "foodType": "protein",
        "cookingMethod": "grilled"
      },
      {
        "scoutIndex": 2,
        "canonicalDbName": "Avocado, Hass, peeled, raw",
        "weightGrams": 90,
        "foodType": "fruit/fat source",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 3,
        "canonicalDbName": "Lettuce, iceberg, raw",
        "weightGrams": 30,
        "foodType": "vegetable",
        "cookingMethod": "raw"
      }
    ]
  }
}
`;

const REQUIRED_OUTPUT_JSON_SCHEMA = `
=== REQUIRED OUTPUT JSON SCHEMA ===
{
  "_internalReasoning": "string (Silently synthesize clinical evidence and plan response structure)",
  "verdict": {
    "label": "string (3-6 words max: positive outcome or pre-calculated metric overage)",
    "level": "string ('good' | 'warning' | 'alert' | 'neutral')"
  },
  "message": "string (35-70 words in 4 beats as specified above)",
  "foodData": {
    "date": "string (YYYY-MM-DD)",
    "name": "string (Meal title matching singular/plural form of breakdown items)",
    "itemsBreakdown": [
      {
        "scoutIndex": 0,
        "canonicalDbName": "string (standard database/product name, 2-5 words max)",
        "weightGrams": 0,
        "foodType": "string (1-2 words: grain | protein | vegetable | fruit | dairy | entree)",
        "cookingMethod": "string (1-2 words: raw | baked | grilled | boiled | fried)",
        "correctedNutrients": {
          "calories": 250,
          "protein": 15,
          "carbohydrates": 30,
          "totalFat": 8,
          "saturatedFat": 2.5,
          "sodium": 450,
          "addedSugar": 0,
          "totalFibre": 2
        },
        "clinicalCorrectionNote": "string | null (Optional reason if baseline was adjusted)"
      }
    ]
  },
  "comparison": {
    "comparisonTitle": "string (e.g. 'Nutrients of Concern')",
    "groups": [
      {
        "groupName": "string (Descriptive option title e.g. 'Tier 1 - Safest Choice')",
        "scoutItemIndices": [0],
        "verdict": {
          "label": "string (3-6 words max)",
          "level": "string ('good' | 'warning' | 'alert' | 'neutral')"
        },
        "message": "string (35-70 words in 4 beats)",
        "averageNutrients": {
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "sodium": 0,
          "carbohydrates": 0,
          "addedSugar": 0,
          "potassium": 0,
          "totalFibre": 0
        }
      }
    ]
  }
}
`;

export function buildFoodAnalyzeInstruction(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  activeMeal?: any;
  compareItemCount?: number;
  forceModifyMode?: boolean;
  foodLogs?: any[];
  userProfile?: any;
}): string {
  const { biomarkersList, targetLimits } = formatPatientContext(context);
  const { activeMeal, forceModifyMode = false } = context;

  let sanitizedActiveMeal = null;
  if (activeMeal) {
    sanitizedActiveMeal = { ...activeMeal };
    if (sanitizedActiveMeal.imageUrl && sanitizedActiveMeal.imageUrl.startsWith("data:image/")) {
      sanitizedActiveMeal.imageUrl = "[base64_image_data_truncated]";
    }
  }

  const mealStr = sanitizedActiveMeal ? JSON.stringify(sanitizedActiveMeal, null, 2) : "None";

  return `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

${DIETITIAN_CORE_DIRECTIVES}

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}

${targetLimits}

=== ACTIVE TASK: FOOD ANALYSIS & LOGGING ===
${forceModifyMode ? "Re-evaluate the active meal incorporating the patient's requested edits (weight corrections, name fixes, or ingredient swaps)." : "Process the scanned meal, verify database matches, perform nutritional analysis, and return the log details."}

${REQUIRED_OUTPUT_JSON_SCHEMA}`;
}

export function buildModeAReviewInstruction(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  foodLogs?: any[];
  userProfile?: any;
}): string {
  const { biomarkersList, targetLimits } = formatPatientContext(context);

  return `${DIETITIAN_CORE_DIRECTIVES}

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}

${targetLimits}

=== ACTIVE TASK: NEW FOOD LOGGING ===
DEFAULT TO CONSUMPTION: Process the identified food logs and visual scout items as a consumed meal. Provide constructive, warm clinical analysis on today's target fit.

${REQUIRED_OUTPUT_JSON_SCHEMA}`;
}

export function buildModeAEditInstruction(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  activeMeal?: any;
  foodLogs?: any[];
  userProfile?: any;
}): string {
  const { biomarkersList, targetLimits } = formatPatientContext(context);
  let sanitizedActiveMeal = null;
  if (context.activeMeal) {
    sanitizedActiveMeal = { ...context.activeMeal };
    if (sanitizedActiveMeal.imageUrl && sanitizedActiveMeal.imageUrl.startsWith("data:image/")) sanitizedActiveMeal.imageUrl = "[base64_image_data_truncated]";
    if (sanitizedActiveMeal.imageUrls) sanitizedActiveMeal.imageUrls = [];
    delete sanitizedActiveMeal.chatTranscript;
    delete sanitizedActiveMeal.receiptTable;
    delete sanitizedActiveMeal.nutrients;
    delete sanitizedActiveMeal.verdict;
    if (sanitizedActiveMeal.itemsBreakdown && Array.isArray(sanitizedActiveMeal.itemsBreakdown)) {
      sanitizedActiveMeal.itemsBreakdown = sanitizedActiveMeal.itemsBreakdown.map((item: any) => ({
        scoutIndex: item.scoutIndex,
        dbId: item.dbId,
        canonicalDbName: item.canonicalDbName || item.name,
        foodType: item.foodType,
        weightGrams: item.weightGrams,
        dbSource: item.dbSource,
        cookingMethod: item.cookingMethod
      }));
    }
  }
  const mealStr = sanitizedActiveMeal ? JSON.stringify(sanitizedActiveMeal, null, 2) : "None";

  return `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

${DIETITIAN_CORE_DIRECTIVES}

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}

${targetLimits}

=== ACTIVE TASK: ACTIVE MEAL REASSESSMENT / EDIT ===
Update CURRENT_ACTIVE_MEAL_STATE based on the user's edit message.
Classify item changes into "modificationCommand" (UPDATE_WEIGHT, REMOVE_ITEM, ADD_ITEM, REPLACE_ITEM).
In "message", Beat 1 must explicitly confirm the specific modification (e.g. "Updated your iced tea to unsweetened, removing 18g added sugar"), then provide 4-beat clinical guidance on the updated totals. Retain descriptive dish names in "itemsBreakdown".

${REQUIRED_OUTPUT_JSON_SCHEMA}`;
}

export function buildModeDCompareInstruction(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  foodLogs?: any[];
  userProfile?: any;
}): string {
  const { biomarkersList, targetLimits } = formatPatientContext(context);

  return `${DIETITIAN_CORE_DIRECTIVES}

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}

${targetLimits}

=== ACTIVE TASK: PRODUCT EVALUATION & COMPARISON ===
Evaluate and rank each scanned item / option individually or into distinct comparison groups based on the patient's biomarker warnings and remaining budgets.
You MUST provide the "comparison" object in your JSON response. Inside "comparison.groups", map scout items using "scoutItemIndices" (e.g. [0] for item 0, [1] for item 1).

CRITICAL SMALL-COUNT GROUPING RULE:
- If there are LESS THAN 3 total scanned items (e.g. 1 or 2 items), DO NOT group multiple items together into a single group or create artificial third tiers.
- Instead, create EXACTLY 1 group per scanned item (a group size of 1 item per group), mapping each item individually in "scoutItemIndices" (e.g. Group 1 with scoutItemIndices: [0], Group 2 with scoutItemIndices: [1]).
- If there are 3 or more total scanned items, rank and organize them into distinct ranked tier groups (e.g. Tier 1 - Best Choice, Tier 2 - Runner Up, Tier 3 - Less Suitable).
- The groups MUST be sorted by overall health ranking, best choice first. Use the group's "verdict.level" ('good', 'warning', 'alert', 'neutral') to define the rank of the group.
- Do NOT lump all items into a single bucket. Set the top-level "message", "verdict", and "foodData" to null in comparison mode.
Mandate: averageNutrients for each group must equal the mean of server preCalc nutrients for scoutItemIndices, or omit averageNutrients/set to null to let the server calculate it automatically.

${REQUIRED_OUTPUT_JSON_SCHEMA}`;
}

export function buildModeDEditInstruction(context: {
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any | null;
  activeComparison?: any;
  foodLogs?: any[];
  userProfile?: any;
}): string {
  const { biomarkersList, targetLimits } = formatPatientContext(context);
  let sanitizedComparison = null;
  if (context.activeComparison) {
    sanitizedComparison = { ...context.activeComparison };
    delete sanitizedComparison.chatTranscript;
    // Comparisons typically have arrays of meals
    if (sanitizedComparison.meals && Array.isArray(sanitizedComparison.meals)) {
       sanitizedComparison.meals = sanitizedComparison.meals.map((m: any) => {
         const sm = { ...m };
         if (sm.imageUrl && sm.imageUrl.startsWith("data:image/")) sm.imageUrl = "[base64_image_data_truncated]";
         if (sm.imageUrls) sm.imageUrls = [];
         delete sm.receiptTable;
         delete sm.nutrients;
         delete sm.verdict;
         if (sm.itemsBreakdown && Array.isArray(sm.itemsBreakdown)) {
           sm.itemsBreakdown = sm.itemsBreakdown.map((item: any) => ({
             scoutIndex: item.scoutIndex,
             dbId: item.dbId,
             canonicalDbName: item.canonicalDbName || item.name,
             foodType: item.foodType,
             weightGrams: item.weightGrams,
             dbSource: item.dbSource,
             cookingMethod: item.cookingMethod
           }));
         }
         return sm;
       });
    }
  }
  const compStr = sanitizedComparison ? JSON.stringify(sanitizedComparison, null, 2) : "None";

  return `CURRENT_ACTIVE_COMPARISON_STATE: ${compStr}

${DIETITIAN_CORE_DIRECTIVES}

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}

${targetLimits}

=== ACTIVE TASK: COMPARISON REFINEMENT ===
Update your product selection and clinical coaching feedback based on the user's portion adjustments or questions.
CRITICAL INSTRUCTION: You MUST explicitly refresh all numerical callouts and calculations in both the "message" and "verdict" fields to reflect the new weights or item adjustments. Do NOT copy-paste the previous turn's narrative if weights have changed.

${REQUIRED_OUTPUT_JSON_SCHEMA}`;
}
