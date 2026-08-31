import { Router } from 'express';
import { buildFoodAnalyzeInstruction } from './agents/index.js';
import { withGeminiRetry } from './server_gemini_retry.js';
import {
  addDebugLog,
  getGeminiClient,
  adminAuth,
  db,
} from './server.js';
import { runFoodAnalyze } from './server_food_analyze_run.js';

export const foodAnalyzeRouter = Router();

// GET Endpoint for System Instruction Preview
foodAnalyzeRouter.get("/api/gemini/instruction-preview", async (req, res) => {
  try {
    const { agentType, biomarkersNeedingImprovement, remainingAllowance, activeMeal } = req.query;
    
    if (agentType === 'food_scout') {
      const instruction = `You are a fast visual food identification agent. Look at the image and return a short list of plain-text search keywords for the food items you see (e.g. ['fried chicken', 'white rice', 'sambal']), plus a rough estimated weight in grams for each if visually judgeable. Do not do any nutrition or clinical analysis. Also try to identify any clues on how it's cooked (e.g., oil cooked, fried, steamed) or freshness (e.g., fresh fish). Include these details in your keywords if helpful. Output only: { "items": [{ "keyword": string, "estimatedWeightGrams": number }] }`;
      return res.json({ instruction });
    }

    if (agentType === 'food') {
      let parsedBiomarkers: any[] | undefined = undefined;
      let parsedAllowance: any = undefined;
      let parsedMeal: any = undefined;

      try {
        if (biomarkersNeedingImprovement && typeof biomarkersNeedingImprovement === 'string') {
          parsedBiomarkers = JSON.parse(biomarkersNeedingImprovement);
        }
      } catch (e) {}

      try {
        if (remainingAllowance && typeof remainingAllowance === 'string') {
          parsedAllowance = JSON.parse(remainingAllowance);
        }
      } catch (e) {}

      try {
        if (activeMeal && typeof activeMeal === 'string') {
          parsedMeal = JSON.parse(activeMeal);
        }
      } catch (e) {}

      // If they are not passed or empty, try to look up the user's synced context
      if (!parsedBiomarkers || !parsedAllowance) {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (idToken) {
          try {
            const decoded = await adminAuth.verifyIdToken(idToken);
            const uid = decoded.uid;
            
            if (db) {
              // Try to fetch reports/latest
              const reportRef = db.collection('users').doc(uid).collection('reports').doc('latest');
              const reportSnap = await reportRef.get();
              if (reportSnap.exists) {
                const reportData = reportSnap.data();
                if (reportData && Array.isArray(reportData.biomarkers)) {
                  parsedBiomarkers = reportData.biomarkers.filter((b: any) => b.status === 'At Risk' || b.status === 'HIGH' || b.status === 'LOW');
                }
              }

              // Try to fetch dashboard
              const dashRef = db.collection('users').doc(uid).collection('metadata').doc('dashboard');
              const dashSnap = await dashRef.get();
              if (dashSnap.exists) {
                const dashData = dashSnap.data();
                if (dashData) {
                  if (!parsedAllowance && dashData.remainingAllowance) {
                    parsedAllowance = dashData.remainingAllowance;
                  }
                  if (!parsedMeal && dashData.activeMeal) {
                    parsedMeal = dashData.activeMeal;
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[instruction-preview] Error loading authenticated user context:", err);
          }
        }
      }

      // Safe placeholder values as fallback
      if (!parsedBiomarkers) {
        parsedBiomarkers = [];
      }
      if (!parsedAllowance) {
        parsedAllowance = {
          calories: 2000,
          saturatedFat: 20,
          sodium: 2300
        };
      }

      const instruction = buildFoodAnalyzeInstruction({
        biomarkersNeedingImprovement: parsedBiomarkers,
        remainingAllowance: parsedAllowance,
        activeMeal: parsedMeal
      });

      return res.json({ instruction });
    }

    return res.status(400).json({ error: "Unsupported agentType" });
  } catch (error: any) {
    console.error("[instruction-preview] Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Gemini Food Analyze Endpoint

// Health Preparation Agent
foodAnalyzeRouter.post("/api/gemini/front-desk", async (req, res) => {
  try {
    const { message, profile, biomarkers, foodLogs, biomarkerHistory, engine } = req.body;
    
    let targetModel = typeof engine === 'object' ? engine?.name || engine?.model || "gemini-3.5-flash-lite" : (engine || "gemini-3.5-flash-lite");
  

    const cleanedHistory = (biomarkerHistory || []).slice().reverse().map((item: any) => {
      if (!item) return item;
      const clean = { ...item };
      if (typeof clean.note === 'string') {
        clean.note = Array.from(new Set(clean.note.split(/[;|\n]/).map((s: string) => s.trim()).filter(Boolean))).join('; ');
      }
      if (typeof clean.summary === 'string') {
        clean.summary = Array.from(new Set(clean.summary.split(/[;|\n]/).map((s: string) => s.trim()).filter(Boolean))).join('; ');
      }
      return clean;
    });

    const prompt = `
You are the Health Preparation Agent. Your job is to answer the user's questions regarding their health data, and guide them on what they should do next.
You have access to their profile, biomarkers, and food logs.

<USER_DATA>
Profile: ${JSON.stringify(profile, null, 2)}
Biomarkers: ${JSON.stringify(biomarkers, null, 2)}
Food Logs (Last 5): ${JSON.stringify(foodLogs ? foodLogs.slice(0, 5) : [], null, 2)}
Recent Biomarker History (most recent first, up to 40 entries): ${JSON.stringify(cleanedHistory, null, 2)}
</USER_DATA>

If the user asks "What should I do?", analyze their data and see what is missing (e.g. missing age, weight, or missing biomarkers, or no food logs logged).
Advise them on which of the 5 specialized agents to use:
- Add Health Data
- Review Biomarkers
- Clinical Review
- Health Planning
- Medical Insights

If the user gives you information to update their profile (like their weight, height, age, blood type), you MUST include a JSON block in your response to update the profile.
Format for updating profile and adding biomarker logs:
\`\`\`json
{
  "updatedProfile": {
    "weight": 70,
    "height": 175,
    "age": 30
  },
  "newBiomarkerLogs": [
    { "biomarker": "HbA1c", "value": 5.5, "unit": "%", "date": "2023-10-10" }
  ]
}
\`\`\`
Any fields you specify in the JSON will be merged into their profile. 

Answer the user's message directly and concisely.

User Message: ${message}
`;

    addDebugLog(`[FrontDesk] Dispatching prompt to model: "${targetModel}".`);
    addDebugLog(`[FrontDesk-Prompt] User Prompt:\n${prompt}`);

    const ai = getGeminiClient();
    const response = await withGeminiRetry(() => ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        httpOptions: { timeout: 60000 }
      }
    }));

    const reply = response.text || "";
    addDebugLog(`[FrontDesk-Response] ${reply}`);
    
    // Parse updatedProfile if any
    let updatedProfile = null;
    let newBiomarkerLogs = null;
    const jsonMatch = reply.match(/\`\`\`json\s*({[\s\S]*?})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.newBiomarkerLogs) {
          newBiomarkerLogs = parsed.newBiomarkerLogs;
        }
        if (parsed.updatedProfile) {
          updatedProfile = { ...profile, ...parsed.updatedProfile };
        }
      } catch(e) {}
    }

    res.json({ agentPrompt: prompt, text: reply.replace(/\`\`\`json[\s\S]*?\`\`\`/g, '').trim(), updatedProfile, newBiomarkerLogs, type: 'front_desk' });
  } catch (err: any) {
    console.error("Front Desk Error:", err);
    res.status(500).json({ error: err.message });
  }
});



foodAnalyzeRouter.post("/api/gemini/food-analyze", (req, res) => {
  return runFoodAnalyze(req, res);
});
