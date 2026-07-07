const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /app\.post\("\/api\/gemini\/consolidate-names", async \(req, res\) => \{[\s\S]*?res\.status\(500\)\.json\(\{ error: "Failed to consolidate biomarker names: " \+ error\.message \}\);\n  \}\n\}\);/;

const replacement = `app.post("/api/gemini/consolidate-names", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, selectedBiomarkers, engine, customSystemInstruction } = req.body;
    const modelId = engine || "gemini-3.1-flash-lite";
    addDebugLog(\`[Name Consolidation Agent] Request received using model: \${modelId}. Text length: \${inputText?.length || 0}. Biomarkers count: \${selectedBiomarkers?.length || 0}\`, explicitSessionId);

    if (inputText) {
      addDebugLog(\`[Name Consolidation Agent] User Prompt:\\n\${inputText}\`, explicitSessionId);
    }

    let systemInstruction = \`You are an automated Name Consolidation Agent. Your task is to identify clinical biomarkers with similar, synonymous, or variant names from a selected list and group them together to make consolidation easy.

=== OBJECTIVE ===
Analyze the selected list of biomarkers and group them by clinical equivalence (e.g. "Serum Albumin", "Albumin, Serum", "Albumin g/L" are all the same clinical biomarker and should be grouped together).
For each matched group, determine:
1. A standard recommended clinical name (e.g. "Serum Albumin").
2. A recommended unique key using snake_case (e.g. "serum_albumin").
3. A list of all matching source biomarkers that belong to this group.

=== SYSTEM CONSTRAINTS ===
- You MUST return a JSON object with this exact structure. Do NOT wrap it in markdown blocks. Return ONLY the raw valid JSON.

JSON Schema:
{
  "explanation": "A friendly conversational summary answering the user's prompt or explaining the proposed groupings.",
  "yamlText": "The RAW YAML text containing the flat YAML array of objects representing the groups. IMPORTANT: The yamlText field must contain a string formatted in valid YAML as shown below."
}

Expected YAML structure for the 'yamlText' field string:
- groupName: "Group Title (e.g. Serum Albumin)"
  recommendedClinicalName: "Recommended Clinical Name"
  recommendedUniqueKey: "recommended_unique_key"
  biomarkers:
    - key: "original_biomarker_key"
      name: "Original Biomarker Name"
      medicalGrouping: "Original Medical Grouping"
      unit: "Original Unit"
      range: "Original normal range"
      description: "Original description"

Biomarkers to process:
\${JSON.stringify(selectedBiomarkers, null, 2)}\`;

    if (customSystemInstruction) {
      addDebugLog(\`[Name Consolidation Agent] Overriding system instruction with custom version (\${customSystemInstruction.length} chars).\`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    const dynamicPromptText = \`USER DATA / CONVERSATION TEXT:
\\\"\\\"\\\"\${inputText || "Please identify the duplicates from the provided list and consolidate them."}\\\"\\\"\\\"

Please output a valid JSON object matching the requested schema.\`;

    addDebugLog(\`[Name Consolidation Agent] Dispatched Model ID: \${modelId}\`, explicitSessionId);

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: dynamicPromptText,
      responseMimeType: "application/json"
    });

    let cleanJson = textOutput.trim();
    addDebugLog(\`[Name Consolidation Agent] Agent output payload:\\n\${cleanJson}\`, explicitSessionId);
    
    if (cleanJson.includes("\`\`\`")) {
      const match = cleanJson.match(/\`\`\`(?:json)?([\\s\\S]*?)\`\`\`/);
      if (match) {
        cleanJson = match[1].trim();
      } else {
        cleanJson = cleanJson.replace(/\`\`\`(?:json)?/gi, "").trim();
      }
    }
    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(cleanJson);
    
    if (parsed.explanation) {
      addDebugLog(\`[Name Consolidation Agent] Agent Explanation:\\n\${parsed.explanation}\`, explicitSessionId);
    }

    res.json(parsed);
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(\`[Name Consolidation Agent] Error: \${error.message}\`, explicitSessionId);
    console.error("[Name Consolidation Agent Error]:", error);
    res.status(500).json({ error: "Failed to consolidate biomarker names: " + error.message });
  }
});`;

code = code.replace(regex, replacement);
fs.writeFileSync('server.ts', code);
