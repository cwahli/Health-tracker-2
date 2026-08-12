with open('server.ts', 'r') as f:
    lines = f.readlines()

new_content = """        parsedData.receiptTable = receiptTable;

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
        }
"""
lines = lines[:9944] + [new_content] + lines[9984:]

with open('server.ts', 'w') as f:
    f.writelines(lines)
print("Done")
