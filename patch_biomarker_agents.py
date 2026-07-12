import re

with open('server.ts', 'r') as f:
    content = f.read()

# 1. Standardize Units Agent
standardize_schema = """
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
"""
content = re.sub(
    r'const textOutput = await callUnifiedLLM\(\{\s*modelId,\s*systemInstruction,\s*promptText: "Please output the standardized units in YAML format according to the requested schema. Output ONLY raw YAML.",\s*responseMimeType: "text/plain"\s*\}\);',
    standardize_schema + """
    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\\n\\nJSON STRUCTURED OUTPUT:\\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the 'scratchpad' field first.",
      promptText: "Please output the standardized units in JSON format.",
      responseMimeType: "application/json",
      responseSchema: standardizeUnitsSchema
    });""",
    content
)
# Update standardize-units parser
content = re.sub(
    r'let cleanYaml = textOutput.replace.*?res\.json\(\{ yamlText: cleanYaml \}\);',
    r"""let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Standardize Units Agent] Agent output payload:\n${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });""",
    content, flags=re.DOTALL
)

# 2. Medical Categorise Agent
categorise_schema = """
    const medicalCategoriseSchema = {
      type: Type.OBJECT,
      properties: {
        scratchpad: { type: Type.STRING, description: "Think step-by-step: analyze the biomarker, identify its primary physiological system, and determine risk levels based on clinical guidelines." },
        categorisedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              primaryCategory: { type: Type.STRING },
              subCategory: { type: Type.STRING },
              clinicalSignificance: { type: Type.STRING },
              standardRiskLevels: {
                type: Type.OBJECT,
                properties: {
                  low: { type: Type.STRING },
                  optimal: { type: Type.STRING },
                  high: { type: Type.STRING }
                }
              }
            }
          }
        }
      },
      required: ["scratchpad", "categorisedBiomarkers"]
    };
"""
content = re.sub(
    r'const textOutput = await callUnifiedLLM\(\{\s*modelId,\s*systemInstruction,\s*promptText: "Please output the categorisation in YAML format according to the requested schema. Output ONLY raw YAML.",\s*responseMimeType: "text/plain"\s*\}\);',
    categorise_schema + """
    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\\n\\nJSON STRUCTURED OUTPUT:\\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the 'scratchpad' field first.",
      promptText: "Please output the categorisation in JSON format.",
      responseMimeType: "application/json",
      responseSchema: medicalCategoriseSchema
    });""",
    content
)
# Update medical-categorise parser
content = re.sub(
    r'let cleanYaml = textOutput.replace.*?res\.json\(\{ yamlText: cleanYaml \}\);',
    r"""let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Medical Categorisation Agent] Agent output payload:\n${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });""",
    content, flags=re.DOTALL
)

# 3. Consolidate Names Agent
consolidate_schema = """
    const consolidateNamesSchema = {
      type: Type.OBJECT,
      properties: {
        scratchpad: { type: Type.STRING, description: "Think step-by-step: compare the provided names, identify synonyms, determine the most universally recognized clinical name, and map variants." },
        consolidatedGroups: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              canonicalName: { type: Type.STRING },
              variants: { type: Type.ARRAY, items: { type: Type.STRING } },
              rationale: { type: Type.STRING }
            }
          }
        }
      },
      required: ["scratchpad", "consolidatedGroups"]
    };
"""
content = re.sub(
    r'const textOutput = await callUnifiedLLM\(\{\s*modelId,\s*systemInstruction,\s*promptText: dynamicPromptText,\s*responseMimeType: "application/json"\s*\}\);',
    consolidate_schema + """
    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\\n\\nJSON STRUCTURED OUTPUT:\\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the 'scratchpad' field first.",
      promptText: dynamicPromptText,
      responseMimeType: "application/json",
      responseSchema: consolidateNamesSchema
    });""",
    content
)

# 4. Data Accuracy Agent
accuracy_schema = """
    const dataAccuracySchema = {
      type: Type.OBJECT,
      properties: {
        scratchpad: { type: Type.STRING, description: "Think step-by-step: analyze the data points, verify physical biological limits, check against provided documents if any, and detect anomalies." },
        anomalies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              biomarkerKey: { type: Type.STRING },
              flagType: { type: Type.STRING },
              description: { type: Type.STRING },
              severity: { type: Type.STRING },
              recommendedAction: { type: Type.STRING }
            }
          }
        },
        generalAccuracyScore: { type: Type.NUMBER },
        overallAssessment: { type: Type.STRING }
      },
      required: ["scratchpad", "anomalies", "generalAccuracyScore", "overallAssessment"]
    };
"""
content = re.sub(
    r'const textOutput = await callUnifiedLLM\(\{\s*modelId,\s*systemInstruction,\s*promptText: dynamicPromptText,\s*imagePayloads: imagesPayload,\s*responseMimeType: "application/json"\s*\}\);',
    accuracy_schema + """
    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\\n\\nJSON STRUCTURED OUTPUT:\\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the 'scratchpad' field first.",
      promptText: dynamicPromptText,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json",
      responseSchema: dataAccuracySchema
    });""",
    content
)

with open('server.ts', 'w') as f:
    f.write(content)
