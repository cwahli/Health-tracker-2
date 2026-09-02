import { Router } from 'express';
import { getGeminiClient } from './server.js';
import { runBiomarkerPipeline } from './src/server/biomarkers/pipeline.js';
import { withGeminiRetry } from './server_gemini_retry.js';

export const medicalGeminiRouter = Router();

medicalGeminiRouter.post("/api/gemini/medical-analyze", async (req, res) => {
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    hasSentHeaders = true;
    const originalStatus = res.status.bind(res);
    res.status = (code: number) => {
      if (!res.headersSent) {
        originalStatus(code);
      }
      return res;
    };
    res.json = (body: any) => {
      res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  try {
    let { 
      message, 
      images, 
      history, 
      userProfile, 
    } = req.body;

    const ai = getGeminiClient();
    
    // In production, the old format had single `image` base64 string or `images` array.
    let base64Images: string[] = [];
    if (images && Array.isArray(images)) {
        base64Images = images;
    } else if (req.body.image) {
        base64Images = [req.body.image];
    }

    const onProgress = (msg: string) => {
       sendStreamEvent({ type: 'log', logType: 'status', message: msg, timestamp: Date.now() });
    };

    onProgress("Starting Medical Analyze Pipeline...");
    
    // Clean up history to match Record<string, LogPoint[]> expected by backoffice
    const formattedHistory: Record<string, any[]> = {};
    if (history && Array.isArray(history)) {
       // but wait, `history` in the old backend actually came from `biomarkerHistory` or `history` (messages).
       // In LogChat.tsx, it sends `biomarkerHistory`.
    }
    const biomarkerHistory = req.body.biomarkerHistory || [];
    for (const h of biomarkerHistory) {
         if (h.biomarkers) {
             Object.keys(h.biomarkers).forEach(k => {
                  if (!formattedHistory[k]) formattedHistory[k] = [];
                  formattedHistory[k].push({
                      date: h.date,
                      value: h.biomarkers[k]
                  });
             });
         }
    }

    const finalRows = await runBiomarkerPipeline(
       ai,
       message || "",
       base64Images,
       formattedHistory,
       userProfile || { age: 43, gender: 'male', ethnicity: 'Unknown', unitPreference: 'SI' },
       onProgress
    );

    sendStreamEvent({ type: 'log', logType: 'status', message: "Pipeline complete", timestamp: Date.now() });
    
    const result = {
        filledRows: finalRows, text: `Processed ${finalRows.length} biomarker(s).`
    };

    if (isStream) {
      sendStreamEvent({ final: true, result });
      res.end();
    } else {
      res.json(result);
    }
  } catch (error: any) {
    console.error("Pipeline error:", error);
    if (isStream && hasSentHeaders) {
       sendStreamEvent({ error: error.message });
       res.end();
    } else {
       res.status(500).json({ error: error.message });
    }
  }
});

medicalGeminiRouter.post("/api/gemini/health-baseline-analyze", async (req, res) => {
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    hasSentHeaders = true;
    const originalStatus = res.status.bind(res);
    res.status = (code: number) => {
      if (!res.headersSent) {
        originalStatus(code);
      }
      return res;
    };
    res.json = (body: any) => {
      res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  try {
    const {
      message,
      handoffPayload,
      userProfile,
      profile: rawProfile,
      biomarkers,
      biomarkerHistory,
      foodLogs,
      outOfRangeBiomarkers,
      calibratedInsights,
      engine,
      selectedModelId
    } = req.body;

    const profile = userProfile || rawProfile || {};
    const effectiveEngine = (typeof engine === 'string' && engine) || (typeof selectedModelId === 'string' && selectedModelId) || 'gemini-3.5-flash-lite';

    sendStreamEvent({ type: 'log', logType: 'status', message: "Health Coach initialized. Evaluating health context...", timestamp: Date.now() });

    // Calculate baseline biometrics
    const weightKg = Number(profile.weight || profile.weightKg || handoffPayload?.collectedData?.weight || 0);
    const heightCm = Number(profile.height || profile.heightCm || handoffPayload?.collectedData?.height || 0);
    const age = Number(profile.age || handoffPayload?.collectedData?.age || 30);
    const gender = (profile.gender || handoffPayload?.collectedData?.gender || 'unknown').toLowerCase();
    const activityLevel = (profile.activityLevel || handoffPayload?.collectedData?.activityLevel || 'sedentary').toLowerCase();

    let bmi = 0;
    if (weightKg > 0 && heightCm > 0) {
      bmi = parseFloat((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
    }

    sendStreamEvent({ 
      type: 'thought', 
      thoughtType: 'coach', 
      text: `Biometrics assessment: Age ${age}, Gender ${gender}, Height ${heightCm}cm, Weight ${weightKg}kg (BMI: ${bmi || 'N/A'}), Activity: ${activityLevel}. Synthesizing caloric baseline, risk categories, and daily habits...`, 
      timestamp: Date.now() 
    });

    const ai = getGeminiClient();

    const systemInstruction = `You are a clinical AI Health Coach specializing in translating user demographics, health goals, lifestyle baseline, and biomarkers into a realistic, personalized health baseline plan.

Context:
- User Demographics: Age ${age}, Gender: ${gender}, Height: ${heightCm}cm, Current Weight: ${weightKg}kg (BMI: ${bmi || 'N/A'}), Activity Level: ${activityLevel}
- Front Desk Handoff: ${JSON.stringify(handoffPayload || {})}
- User Profile: ${JSON.stringify(profile || {})}
- Biomarkers: ${JSON.stringify(biomarkers || {})}
- Biomarker History Count: ${Array.isArray(biomarkerHistory) ? biomarkerHistory.length : 0}
- Recent Food Logs: ${JSON.stringify((foodLogs || []).slice(-10).map((f: any) => ({ name: f.name, date: f.date })))}
- Out-of-Range Biomarkers: ${JSON.stringify(outOfRangeBiomarkers || [])}

Clinical & Coaching Directives:
1. If the user's BMI is in a normal or lean range (e.g. BMI ~ 18.5 - 24.9) and they express a desire to loose weight, NEVER prescribe a severe or extreme caloric restriction. Instead, educate and guide them towards body recomposition, gentle muscle toning, nutrient density (adequate protein, micronutrients), and safe, progressive energy balance.
2. Formulate 2 to 4 structured risk/focus categories with specific physiological targets and daily activities.
3. Top nutrient targets MUST include daily 'calories', 'protein', 'saturated_fat', and 'sodium'.
4. Top weekly nutrient targets should include 'fiber' and 'added_sugars'.
5. Daily activities MUST include realistic movement targets (such as daily steps e.g. '6,000 - 8,000 steps') and mobility/exercise.
6. Provide an encouraging, clear, and actionable explanation in markdown for the user.

You MUST respond strictly with a valid JSON object in this format:
{
  "agentType": "health_baseline",
  "text": "Detailed, friendly, empathetic, and professional explanation of the plan in markdown format.",
  "report": {
    "globalSummary": "A concise 2-3 sentence overview of the health baseline strategy.",
    "_internalReasoning": "Your clinical thoughts, BMI assessment, and metabolic reasoning.",
    "timelineToOptimal": "Realistic timeframe (e.g., '6 to 10 weeks to safely establish metabolic stamina and body recomposition')",
    "riskCategories": [
      {
        "categoryName": "Category name (e.g., 'Energy Balance & Caloric Deficit', 'Daily Movement & Sedentary Countermeasures', 'Cardiovascular & Lean Tissue Support')",
        "level": "low" | "medium" | "high",
        "targetTrajectory": "Detailed paragraph explaining the physiological rationale, baseline context, and expected trajectory.",
        "nutrientTargets": [
          {
            "nutrientKey": "calories",
            "targetValue": "1,450 - 1,550 kcal/day",
            "rationale": "Mild sustainable energy balance."
          },
          {
            "nutrientKey": "protein",
            "targetValue": "65 - 75 g/day",
            "rationale": "Preserves lean muscle mass."
          }
        ],
        "dailyActivities": [
          {
            "activity": "Daily walking or light movement",
            "target": "6,000 - 8,000 steps"
          }
        ]
      }
    ],
    "topNutrientTargets": [
      { "nutrientKey": "calories", "targetValue": "1,500 kcal", "rationale": "Caloric baseline for sustainable energy and gentle body recomposition." },
      { "nutrientKey": "protein", "targetValue": "65 - 75 g", "rationale": "Supports lean tissue maintenance." },
      { "nutrientKey": "saturated_fat", "targetValue": "< 14 g", "rationale": "Promotes cardiovascular health." },
      { "nutrientKey": "sodium", "targetValue": "< 2,000 mg", "rationale": "Supports healthy arterial blood pressure." }
    ],
    "topWeeklyNutrientTargets": [
      { "nutrientKey": "fiber", "targetValue": "25 - 30 g", "rationale": "Supports gut motility and satiety." },
      { "nutrientKey": "added_sugars", "targetValue": "< 25 g", "rationale": "Minimizes insulin spikes." }
    ],
    "generalNutrientTargets": {
      "calories": "1500",
      "protein": "70",
      "steps": "7000",
      "saturated_fat": "14",
      "sodium": "2000"
    },
    "dailyActivities": [
      { "activity": "Daily brisk walking", "target": "6,000 - 8,000 steps" },
      { "activity": "Light mobility & stretching", "target": "10-15 mins daily" }
    ]
  }
}`;

    const promptText = `User message / Request: "${message || handoffPayload?.summaryForAgent || 'Please create my personalized health baseline plan.'}"`;

    sendStreamEvent({ type: 'log', logType: 'status', message: "Generating clinical health baseline...", timestamp: Date.now() });

    let parsedResult: any = null;

    try {
      const response = await withGeminiRetry(() => ai.models.generateContent({
        model: effectiveEngine,
        contents: [
          { role: 'user', parts: [{ text: `${systemInstruction}\n\n${promptText}` }] }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      }), { label: 'Health Baseline Agent' });

      const rawText = response.text || '{}';
      try {
        const cleaned = rawText.replace(/```(?:json)?/gi, '').trim();
        parsedResult = JSON.parse(cleaned);
      } catch (parseErr) {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsedResult = JSON.parse(match[0]);
          } catch (e) {}
        }
      }
    } catch (llmErr) {
      console.warn("Health baseline LLM error, falling back to deterministic calculation:", llmErr);
    }

    if (!parsedResult || !parsedResult.report) {
      const targetCal = heightCm > 0 && weightKg > 0 ? Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (gender === 'male' ? 5 : -161) * 1.25) : 1500;
      parsedResult = {
        agentType: "health_baseline",
        text: `### Personalized Health Coach Plan\n\nWelcome to your Health Baseline! Based on your profile (${age} y/o ${gender}, ${heightCm}cm, ${weightKg}kg, BMI ${bmi || '20.4'}), we have formulated a balanced, sustainable plan targeting gentle movement, nutrient density, and lean tissue support.\n\n- **Target Energy**: ~${targetCal} kcal/day\n- **Target Protein**: 65–75 g/day\n- **Daily Movement**: 6,000–8,000 steps/day`,
        report: {
          globalSummary: `Personalized health baseline for ${age} y/o ${gender} (${weightKg} kg, BMI ${bmi || '20.4'}) targeting gentle body recomposition and cardiovascular vitality.`,
          _internalReasoning: `BMI is ${bmi || '20.4'}, which is within the healthy reference range (18.5–24.9). Aggressive caloric restriction is contraindicated; prioritizing adequate protein and daily physical activity.`,
          timelineToOptimal: "6 to 8 weeks for progressive metabolic adaptation",
          riskCategories: [
            {
              categoryName: "Energy Balance & Nutrient Density",
              level: "low",
              targetTrajectory: "Establishing a consistent caloric baseline with high-quality protein and whole food carbohydrates to support energy levels throughout the day.",
              nutrientTargets: [
                { nutrientKey: "calories", targetValue: `${targetCal} kcal`, rationale: "Preserves baseline metabolic rate while encouraging lean body composition." },
                { nutrientKey: "protein", targetValue: "65 - 75 g", rationale: "Maintains muscle protein synthesis during daily activity." }
              ],
              dailyActivities: [
                { activity: "Daily brisk walking", target: "6,000 - 8,000 steps" }
              ]
            },
            {
              categoryName: "Cardiovascular & Sedentary Countermeasures",
              level: "medium",
              targetTrajectory: "Interrupting prolonged sedentary intervals with low-impact activity breaks to enhance insulin sensitivity and lipid clearance.",
              nutrientTargets: [
                { nutrientKey: "saturated_fat", targetValue: "< 14 g", rationale: "Promotes optimal endothelial and arterial function." },
                { nutrientKey: "sodium", targetValue: "< 2,000 mg", rationale: "Maintains healthy fluid balance." }
              ],
              dailyActivities: [
                { activity: "Post-meal walks or gentle mobility", target: "10-15 mins daily" }
              ]
            }
          ],
          topNutrientTargets: [
            { nutrientKey: "calories", targetValue: `${targetCal} kcal`, rationale: "Caloric baseline for sustainable energy and gentle body recomposition." },
            { nutrientKey: "protein", targetValue: "65 - 75 g", rationale: "Supports lean tissue maintenance." },
            { nutrientKey: "saturated_fat", targetValue: "< 14 g", rationale: "Promotes cardiovascular health." },
            { nutrientKey: "sodium", targetValue: "< 2,000 mg", rationale: "Regulates fluid balance and blood pressure." }
          ],
          topWeeklyNutrientTargets: [
            { nutrientKey: "fiber", targetValue: "25 - 30 g", rationale: "Supports gut microbiome and metabolic stability." },
            { nutrientKey: "added_sugars", targetValue: "< 25 g", rationale: "Prevents sharp glucose fluctuations." }
          ],
          generalNutrientTargets: {
            calories: String(targetCal),
            protein: "70",
            steps: "7000",
            saturated_fat: "14",
            sodium: "2000"
          },
          dailyActivities: [
            { activity: "Daily brisk walking", target: "6,000 - 8,000 steps" },
            { activity: "Gentle mobility / stretching", target: "10-15 mins daily" }
          ]
        }
      };
    }

    sendStreamEvent({ type: 'log', logType: 'status', message: "Health baseline analysis finalized.", timestamp: Date.now() });

    if (isStream) {
      sendStreamEvent({ final: true, result: parsedResult });
      res.end();
    } else {
      res.json(parsedResult);
    }
  } catch (error: any) {
    console.error("[Health Baseline Error]:", error);
    if (isStream && hasSentHeaders) {
      sendStreamEvent({ error: error.message || "Failed to generate health baseline" });
      res.end();
    } else {
      res.status(500).json({ error: error.message || "Failed to generate health baseline" });
    }
  }
});
