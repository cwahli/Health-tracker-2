import re

with open('server.ts', 'r') as f:
    content = f.read()

# We need to replace the YAML SCHEMA STRICT REQUIREMENT block with JSON instructions
# and define the foodAnalyzeSchema.

yaml_pattern = re.compile(r'YAML SCHEMA STRICT REQUIREMENT:.*?value"`', re.DOTALL)

json_instructions = """JSON STRUCTURED OUTPUT:
You must strictly return a JSON object. Do not add markdown wrappers.
Think step-by-step in the 'scratchpad' field first. Identify the food, read the label numbers, and calculate the clinical risks before filling out the rest of the fields.
Values must be dynamically derived from the patient's specific profile conditions and injected directives.`"""

content = yaml_pattern.sub(json_instructions, content)

# We need to insert the schema definition right before `const finalSystemInstruction`
schema_def = """
    const foodAnalyzeSchema = {
      type: Type.OBJECT,
      properties: {
        scratchpad: {
          type: Type.STRING,
          description: "Think step-by-step here first. Identify the food, read the label numbers, and calculate the clinical risks before filling out the fields below."
        },
        mode: { type: Type.STRING, description: "String indicating active mode: new_log, discussion, modify, or evaluation" },
        message: { type: Type.STRING, description: "A highly personalized conversational response detailing the clinical rationale, biomarker alignment, or modification confirmation." },
        modificationCommand: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "'update_weight' | 'remove_item' | 'add_item'" },
              itemName: { type: Type.STRING, description: "Literal name of the item from the active state to change" },
              newWeightGrams: { type: Type.NUMBER },
              targetDbId: { type: Type.STRING, description: "Optional exact database ID (fdcId or barcode)", nullable: true }
            }
          },
          nullable: true
        },
        foodData: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING, description: "YYYY-MM-DD" },
            name: { type: Type.STRING },
            composition: { type: Type.STRING },
            weightGrams: { type: Type.NUMBER },
            quantity: { type: Type.STRING },
            benefits: { type: Type.STRING },
            risks: { type: Type.STRING },
            healthImpact: { type: Type.STRING },
            recommendation: { type: Type.STRING },
            itemsBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  canonicalDbName: { type: Type.STRING },
                  weightGrams: { type: Type.NUMBER },
                  dbSource: { type: Type.STRING, description: "'usda' | 'off' | 'estimated' | 'label'" },
                  dbId: { type: Type.STRING, nullable: true },
                  labelNutrientsPerServing: {
                    type: Type.OBJECT,
                    properties: {
                      servingSizeGrams: { type: Type.NUMBER },
                      calories: { type: Type.NUMBER },
                      protein: { type: Type.NUMBER },
                      totalFat: { type: Type.NUMBER },
                      saturatedFat: { type: Type.NUMBER },
                      transFat: { type: Type.NUMBER },
                      carbohydrates: { type: Type.NUMBER },
                      addedSugar: { type: Type.NUMBER },
                      sodium: { type: Type.NUMBER },
                      potassium: { type: Type.NUMBER },
                      totalFibre: { type: Type.NUMBER },
                      solubleFibre: { type: Type.NUMBER }
                    },
                    nullable: true
                  }
                }
              }
            }
          },
          nullable: true
        },
        comparison: {
          type: Type.OBJECT,
          properties: {
            keyNutrientConcern: { type: Type.STRING },
            foods: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  weightGrams: { type: Type.NUMBER },
                  suitability: { type: Type.STRING },
                  pros: { type: Type.STRING },
                  cons: { type: Type.STRING }
                }
              }
            },
            comparisonTableYaml: {
              type: Type.OBJECT,
              properties: {
                columns: { type: Type.ARRAY, items: { type: Type.STRING } },
                rows: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      nutrient: { type: Type.STRING },
                      foodA: { type: Type.STRING },
                      foodB: { type: Type.STRING },
                      target: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          },
          nullable: true
        }
      },
      required: ["scratchpad", "mode", "message"]
    };
"""

content = content.replace("    const finalSystemInstruction = customSystemInstruction || systemInstruction;", schema_def + "\n    const finalSystemInstruction = customSystemInstruction || systemInstruction;")

# Now we need to update the callUnifiedLLM to include `responseSchema: foodAnalyzeSchema`
call_pattern = r'const textOutput = await callUnifiedLLM\(\{\s*modelId: engine \|\| "gemini-2\.5-flash",\s*systemInstruction: finalSystemInstruction,\s*promptText,\s*imagePayloads,\s*responseMimeType: "text/plain"\s*\}\);'
call_replacement = """const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-3.1-flash-lite", // Updating to flash-lite as recommended
      systemInstruction: finalSystemInstruction,
      promptText,
      imagePayloads,
      responseMimeType: "application/json",
      responseSchema: foodAnalyzeSchema
    });"""

content = re.sub(call_pattern, call_replacement, content)

# Now we need to update the parser to parse JSON directly instead of YAML
parse_pattern = re.compile(r'let cleanYaml = textOutput.*?let rawParsed;.*?\} catch \(parseErr: any\) \{.*?\} catch \(jsonErr: any\) \{.*?throw parseErr;.*?\}\s*\}', re.DOTALL)
parse_replacement = """let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let rawParsed;
    try {
      rawParsed = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      addDebugLog(`[JSON Parse Error] JSON parse failed: ${parseErr.message}.`);
      throw parseErr;
    }"""
content = parse_pattern.sub(parse_replacement, content)

with open('server.ts', 'w') as f:
    f.write(content)
