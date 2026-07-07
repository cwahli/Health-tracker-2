const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const categoriseEndpoint = `app.post("/api/gemini/medical-categorise", async (req, res) => {
  try {
    const { selectedBiomarkers } = req.body;
    addDebugLog(\`[Medical Categorisation Agent] Request received to categorise \${selectedBiomarkers?.length} biomarkers.\`);

    const systemInstruction = \`You are an automated Clinical Categorisation Agent. Your task is to accurately map medical biomarkers to their appropriate physiological groupings and risk categories.

=== OBJECTIVE ===
For each provided biomarker, determine:
1. Standard Medical Grouping. Allowed values ONLY: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other'
2. Risk Categories. A JSON array of string tags (e.g. ["Cardiovascular", "Metabolic"]) representing associated risks.
3. Potential Medical Conditions. A JSON array of string tags (e.g. ["Fatty Liver", "Obesity"]) representing associated conditions.

=== SYSTEM CONSTRAINTS ===
You MUST work in YAML. Return a single flat YAML array of objects. Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw YAML text.

YAML Array Item Schema:
- key: "biomarker_key"
  name: "Biomarker Name"
  standardMedicalGrouping: "One of the allowed values"
  riskCategories: ["Tag1", "Tag2"]
  potentialMedicalConditions: ["Condition1", "Condition2"]

Biomarkers to process:
\${JSON.stringify(selectedBiomarkers, null, 2)}\`;

    const textOutput = await callUnifiedLLM({
      modelId: "gemini-2.5-flash",
      systemInstruction,
      promptText: "Please output the categorisation in YAML format according to the requested schema. Output ONLY raw YAML.",
      responseMimeType: "text/plain"
    });

    let cleanYaml = textOutput.replace(/\\\`\\\`\\\`(?:yaml|json)?/gi, "").trim();
    addDebugLog(\`[Medical Categorisation Agent] Agent output payload:\\n\${cleanYaml}\`);
    res.json({ yamlText: cleanYaml });
  } catch (error: any) {
    console.error("[Medical Categorisation Agent Error]:", error);
    res.status(500).json({ error: "Failed to categorise biomarkers: " + error.message });
  }
});`;

code = code.replace(
  'app.post("/api/gemini/food-idea"',
  categoriseEndpoint + '\n\napp.post("/api/gemini/food-idea"'
);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts with medical-categorise endpoint");
