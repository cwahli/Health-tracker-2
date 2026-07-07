const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const targetStr = 'app.post("/api/gemini/food-idea", async (req, res) => {';
const replacementStr = `app.post("/api/gemini/daily-recommendation-chat", async (req, res) => {
  addDebugLog('[DailyRecommendation] Starting daily recommendation chat process.');
  try {
    const { message, userProfile, engine, history, foodLogs, biomarkers, report, actions, steps, location } = req.body;
    
    const systemInstruction = \`You are a personalized AI Health Coach. 
Your goal is to look at the user's data (biomarkers, food logs, goals, daily steps, etc.) and provide an actionable, friendly, and clinical daily recommendation or answer their questions.

### User Data Context
Profile: \${JSON.stringify(userProfile)}
Report/Nutrient Targets: \${JSON.stringify(report?.dailyNutrientTargets || {})}
Biomarkers: \${JSON.stringify(biomarkers || {})}
Clinical Actions: \${JSON.stringify(actions || {})}
Recent Food Logs (titles & dates): \${JSON.stringify((foodLogs || []).slice(-15).map((f) => ({name: f.name, date: f.date})))}
Today's Steps: \${steps || 'Unknown'}
Location: \${JSON.stringify(location || 'Unknown')}

### Guidelines
1. Be concise, friendly, and practical.
2. If this is the start of the chat (e.g. user says "What's up today?"), summarize what they've achieved so far and give 1-2 practical recommendations for today.
3. If the user asks a question, answer it based on their data.
4. Use markdown formatting to make the response highly readable.
5. Do NOT output JSON. Output pure markdown text.\`;

    let historyText = "";
    if (history && Array.isArray(history)) {
      historyText = history.map((m) => \`\${m.role === 'user' ? 'User' : 'Model'}: \${m.content}\`).join('\\n');
    }
    
    const promptText = \`Chat History:\\n\${historyText}\\n\\nUser's latest message: "\${message}"\`;
    
    const textOutput = await callUnifiedLLM({
      modelId: engine,
      systemInstruction,
      promptText,
      responseMimeType: "text/plain"
    });
    
    res.json({ text: textOutput.trim() });
  } catch (error) {
    console.error("[Daily Recommendation Error]:", error);
    res.status(500).json({ error: "Failed to generate recommendation: " + error.message });
  }
});

app.post("/api/gemini/food-idea", async (req, res) => {`;
code = code.replace(targetStr, replacementStr);

fs.writeFileSync('server.ts', code);
console.log("Patched server endpoints");
