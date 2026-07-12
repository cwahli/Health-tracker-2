import re

with open('server.ts', 'r') as f:
    content = f.read()

standardize_units_code = """
app.post("/api/gemini/standardize-units", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction } = req.body;
    const modelId = engine || "gemini-3.1-flash-lite";
    addDebugLog(`[Standardize Units Agent] Request received to standardize ${selectedBiomarkers?.length} biomarkers using model: ${modelId}.`, explicitSessionId);

    let systemInstruction = `You are an automated Clinical Unit Standardization Agent. Your task is to accurately standardize medical units for various biomarkers to ensure consistency across the application.
=== OBJECTIVE ===
For each provided biomarker, determine:
1. The most universally accepted standard metric unit (e.g., mg/dL, mmol/L, g/L).
2. The conversion factor to convert from the user's current unit to the standard unit. If no conversion is needed, output 1.
3. Your confidence in the conversion (high, medium, low).
4. Any relevant notes.`;

    if (customSystemInstruction) {
      systemInstruction += `\\n\\n=== CUSTOM INSTRUCTIONS ===\\n${customSystemInstruction}`;
      addDebugLog(`[Standardize Units Agent] Using Custom Instructions:\\n${customSystemInstruction}`, explicitSessionId);
    }
    
    let promptText = `Biomarkers to process:\\n`;
    if (selectedBiomarkers && selectedBiomarkers.length > 0) {
      selectedBiomarkers.forEach((b: any) => {
        promptText += `- key: "${b.key}", name: "${b.name}", currentUnit: "${b.currentUnit || 'Unknown'}"\\n`;
      });
    }

    const standardizeUnitsSchema = {
      type: Type.OBJECT,
      properties: {
        scratchpad: { type: Type.STRING, description: "Think step-by-step: analyze current units, determine standard metric units, perform conversions, check constraints." },
        mappedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              standardizedUnit: { type: Type.STRING },
              conversionFactor: { type: Type.NUMBER },
              confidence: { type: Type.STRING },
              notes: { type: Type.STRING }
            }
          }
        }
      },
      required: ["scratchpad", "mappedBiomarkers"]
    };

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\\n\\nJSON STRUCTURED OUTPUT:\\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the 'scratchpad' field first.",
      promptText,
      responseMimeType: "application/json",
      responseSchema: standardizeUnitsSchema
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Standardize Units Agent] Agent output payload:\\n${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Standardize Units Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Standardize Units Agent Error]:", error);
    res.status(500).json({ error: "Failed to standardize units: " + error.message });
  }
});
"""

content = content.replace('app.post("/api/gemini/medical-categorise"', standardize_units_code + '\napp.post("/api/gemini/medical-categorise"')

with open('server.ts', 'w') as f:
    f.write(content)
