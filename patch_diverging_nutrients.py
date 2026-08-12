import re

with open('server.ts', 'r') as f:
    content = f.read()

old_code = """        // Set the final meal nutrients perfectly
        if (!parsedData.nutrients) parsedData.nutrients = {};
        parsedData.nutrients.calories = cleanNutrientNumber(grandCal);
        parsedData.nutrients.protein = cleanNutrientNumber(grandP);
        parsedData.nutrients.totalFat = cleanNutrientNumber(grandFat);
        parsedData.nutrients.saturatedFat = cleanNutrientNumber(grandSatFat);
        parsedData.nutrients.sodium = cleanNutrientNumber(grandNa);
        parsedData.nutrients.carbohydrates = cleanNutrientNumber(grandCarbs);
        if (parsedData.nutrients) {
          for (const k of Object.keys(parsedData.nutrients)) {
            parsedData.nutrients[k] = cleanNutrientNumber(parsedData.nutrients[k]);
          }
        }

        const finalCal = grandCal;
        const finalP = grandP;
        const finalFat = grandFat;
        const finalSatFat = grandSatFat;
        const finalNa = grandNa;
        receiptTable += `| **🏆 GRAND MEAL TOTAL - ${grandWeight}g** | **${fVal(finalCal)}** | **${fVal(finalP, 'g')}** | **${fVal(finalSatFat, 'g')}** | **${fVal(finalNa, 'mg')}** |\\n`;
        parsedData.receiptTable = receiptTable;

        // Keep receiptTable separate from _internalReasoning so it renders full width in the UI
        // We still stream it as 'thought' for live updates, but the final state will separate it.

        // GUARANTEED ZERO-DISCREPANCY SYNCHRONIZATION ACROSS ALL NARRATIVE FIELDS:
        // Critical Guard: Only synchronize narrative text for single-item meals to prevent grand total overwriting multi-item stats
        if (parsedData.nutrients && parsedData.itemsBreakdown && parsedData.itemsBreakdown.length === 1 && userSelectedMode === 'review') {
          if (rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
          }
          parsedData.message = rawParsed.message;
          if (rawParsed.foodData) {
            if (rawParsed.foodData.benefits) {
              rawParsed.foodData.benefits = synchronizeNarrativeText(rawParsed.foodData.benefits, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
            if (rawParsed.foodData.risks) {
              rawParsed.foodData.risks = synchronizeNarrativeText(rawParsed.foodData.risks, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
            if (rawParsed.foodData.healthImpact) {
              rawParsed.foodData.healthImpact = synchronizeNarrativeText(rawParsed.foodData.healthImpact, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
            if (rawParsed.foodData.recommendation) {
              rawParsed.foodData.recommendation = synchronizeNarrativeText(rawParsed.foodData.recommendation, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
          }
          if (parsedData) {
            if (parsedData.benefits) {
              parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
            if (parsedData.risks) {
              parsedData.risks = synchronizeNarrativeText(parsedData.risks, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
            if (parsedData.healthImpact) {
              parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
            if (parsedData.recommendation) {
              parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, grandCal, grandP, grandFat, grandSatFat, grandNa, grandCarbs);
            }
          }
        }"""

new_code = """        // DIVERGING NUTRIENTS FIX (Aug 2026): The receipt table loop computes its own grand totals 
        // with independent rounding, which historically overwrote the deterministic first-pass 
        // `parsedData.nutrients` that the Dietitian already saw. We now safely discard the 
        // receipt-table's diverging `grand*` variables at the end, and strictly reuse the 
        // pre-existing `parsedData.nutrients` for the final UI table and narrative synchronization.
        
        const finalCal = parsedData.nutrients?.calories ?? grandCal;
        const finalP = parsedData.nutrients?.protein ?? grandP;
        const finalFat = parsedData.nutrients?.totalFat ?? grandFat;
        const finalSatFat = parsedData.nutrients?.saturatedFat ?? grandSatFat;
        const finalNa = parsedData.nutrients?.sodium ?? grandNa;
        const finalCarbs = parsedData.nutrients?.carbohydrates ?? grandCarbs;

        receiptTable += `| **🏆 GRAND MEAL TOTAL - ${grandWeight}g** | **${fVal(finalCal)}** | **${fVal(finalP, 'g')}** | **${fVal(finalSatFat, 'g')}** | **${fVal(finalNa, 'mg')}** |\\n`;
        parsedData.receiptTable = receiptTable;

        // Keep receiptTable separate from _internalReasoning so it renders full width in the UI
        // We still stream it as 'thought' for live updates, but the final state will separate it.

        // GUARANTEED ZERO-DISCREPANCY SYNCHRONIZATION ACROSS ALL NARRATIVE FIELDS:
        // Critical Guard: Only synchronize narrative text for single-item meals to prevent grand total overwriting multi-item stats
        if (parsedData.nutrients && parsedData.itemsBreakdown && parsedData.itemsBreakdown.length === 1 && userSelectedMode === 'review') {
          if (rawParsed.message) {
            rawParsed.message = synchronizeNarrativeText(rawParsed.message, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
          }
          parsedData.message = rawParsed.message;
          if (rawParsed.foodData) {
            if (rawParsed.foodData.benefits) {
              rawParsed.foodData.benefits = synchronizeNarrativeText(rawParsed.foodData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (rawParsed.foodData.risks) {
              rawParsed.foodData.risks = synchronizeNarrativeText(rawParsed.foodData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (rawParsed.foodData.healthImpact) {
              rawParsed.foodData.healthImpact = synchronizeNarrativeText(rawParsed.foodData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (rawParsed.foodData.recommendation) {
              rawParsed.foodData.recommendation = synchronizeNarrativeText(rawParsed.foodData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
          }
          if (parsedData) {
            if (parsedData.benefits) {
              parsedData.benefits = synchronizeNarrativeText(parsedData.benefits, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (parsedData.risks) {
              parsedData.risks = synchronizeNarrativeText(parsedData.risks, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (parsedData.healthImpact) {
              parsedData.healthImpact = synchronizeNarrativeText(parsedData.healthImpact, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
            if (parsedData.recommendation) {
              parsedData.recommendation = synchronizeNarrativeText(parsedData.recommendation, finalCal, finalP, finalFat, finalSatFat, finalNa, finalCarbs);
            }
          }
        }"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open('server.ts', 'w') as f:
        f.write(content)
    print("Patch applied successfully.")
else:
    print("Old code not found. Please verify.")
