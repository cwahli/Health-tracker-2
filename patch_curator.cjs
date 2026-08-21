const fs = require('fs');
let code = fs.readFileSync('server_food_resolver_curator.ts', 'utf8');

const signatureSearch = `  fetchNutrientsFn?: (fdcId: string) => Promise<Record<string, number> | null>,
  searchUSDAFn?: (query: string) => Promise<any[]>
): Promise<Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }>> {`;

const signatureReplace = `  fetchNutrientsFn?: (fdcId: string) => Promise<Record<string, number> | null>,
  searchUSDAFn?: (query: string) => Promise<any[]>,
  fetchFoodDetailsFn?: (fdcId: string) => Promise<{ title: string, nutrients: Record<string, number> } | null>
): Promise<Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }>> {`;

code = code.replace(signatureSearch, signatureReplace);

const boundaryCheckCode = `
function checkMacroBoundary(query: string, nutrients: Record<string, number> | undefined): { passed: boolean; reason?: string } {
    if (!nutrients) return { passed: true };
    const q = (query || '').toLowerCase().trim();
    
    // Dairy/Cheese: Protein >= 12%, Fat <= 50%, Calories <= 550 kcal/100g.
    if (q.includes('cheese') && !q.includes('sauce') && !q.includes('cream')) {
        if ((nutrients.protein || 0) < 12 || (nutrients.totalFat || 0) > 50 || (nutrients.calories || 0) > 550) {
            return { passed: false, reason: \`Macro boundary violation for cheese: P=\${nutrients.protein}, F=\${nutrients.totalFat}, C=\${nutrients.calories}\` };
        }
    }
    
    // Lean Poultry/Meat: Protein >= 18%, Fat <= 15%.
    if (q.includes('chicken breast') || q.includes('turkey breast') || (q.includes('lean') && q.includes('meat'))) {
        if ((nutrients.protein || 0) < 18 || (nutrients.totalFat || 0) > 15) {
            return { passed: false, reason: \`Macro boundary violation for lean meat: P=\${nutrients.protein}, F=\${nutrients.totalFat}\` };
        }
    }
    
    // Fresh Fruit: Fat <= 2%, Carbs <= 25%.
    if ((q.includes('apple') || q.includes('strawberry') || q.includes('blueberry') || q.includes('raspberry') || q.includes('fruit')) && !q.includes('dried')) {
        if ((nutrients.totalFat || 0) > 2 || (nutrients.carbohydrates || 0) > 25) {
             return { passed: false, reason: \`Macro boundary violation for fresh fruit: F=\${nutrients.totalFat}, C=\${nutrients.carbohydrates}\` };
        }
    }
    
    return { passed: true };
}
`;

// Insert it right after imports
code = code.replace(`import { checkCategoryAndStateCompatibility } from './server_food_catalog_schema.js';`, `import { checkCategoryAndStateCompatibility } from './server_food_catalog_schema.js';\n${boundaryCheckCode}`);

const evalCodeSearch = `      if (action && (action.type === 'pick_existing' || action.type === 'normalize_basis')) {
      let finalChosenId: string | null = null;`;

const evalCodeReplace = `      if (action && (action.type === 'pick_existing' || action.type === 'normalize_basis')) {
      let finalChosenId: string | null = null;

      const verifyId = async (id: string, nameToMatch: string) => {
        if (!fetchFoodDetailsFn) return true;
        try {
          const details = await fetchFoodDetailsFn(id);
          if (details) {
            const overlap = calculateTokenOverlap(gap.query, details.title);
            if (overlap < 0.65 && !hasCoreTokenOverlap(gap.query, details.title)) {
              addDebugLog(\`[TitleVerification] REJECTED: FDC \${id} title "\${details.title}" has low similarity with query "\${gap.query}".\`);
              return false;
            }
            const macroCheck = checkMacroBoundary(gap.query, details.nutrients);
            if (!macroCheck.passed) {
              addDebugLog(\`[MacroBoundaryFilter] REJECTED: FDC \${id} \${macroCheck.reason}\`);
              return false;
            }
            return true;
          }
        } catch (e) {}
        return true;
      };
`;

code = code.replace(evalCodeSearch, evalCodeReplace);

// Now update the `if (overlap >= 0.30 || coreMatch) {` parts for parametric FDC ID

const priorityCheckSearch = `        if (overlap >= 0.30 || coreMatch) {
          addDebugLog(\`[ParametricVerification] PASSED (high-confidence, priority) for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}%, coreMatch: \${coreMatch})\`);
          finalChosenId = paramIdStr;
        } else {
          addDebugLog(\`[ParametricVerification] REJECTED for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}% < 30%). Falling back to local dictionary/candidate.\`);
        }`;

const priorityCheckReplace = `        if (overlap >= 0.30 || coreMatch) {
          if (await verifyId(paramIdStr, paramName)) {
            addDebugLog(\`[ParametricVerification] PASSED (high-confidence, priority) for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}%, coreMatch: \${coreMatch})\`);
            finalChosenId = paramIdStr;
          } else {
            addDebugLog(\`[ParametricVerification] VERIFICATION FAILED for high-confidence parametric ID \${paramIdStr}. Re-routing...\`);
          }
        } else {
          addDebugLog(\`[ParametricVerification] REJECTED for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}% < 30%). Falling back to local dictionary/candidate.\`);
        }`;

code = code.replace(priorityCheckSearch, priorityCheckReplace);

// Second verification block

const secCheckSearch = `        if (overlap >= 0.30 || coreMatch) {
          addDebugLog(\`[ParametricVerification] PASSED for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}%, coreMatch: \${coreMatch})\`);
          finalChosenId = paramIdStr;
        } else {
          addDebugLog(\`[ParametricVerification] REJECTED for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}% < 30%). Falling back to candidate.\`);
        }`;

const secCheckReplace = `        if (overlap >= 0.30 || coreMatch) {
          if (await verifyId(paramIdStr, paramName)) {
            addDebugLog(\`[ParametricVerification] PASSED for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}%, coreMatch: \${coreMatch})\`);
            finalChosenId = paramIdStr;
          } else {
             addDebugLog(\`[ParametricVerification] VERIFICATION FAILED for parametric ID \${paramIdStr}. Re-routing...\`);
          }
        } else {
          addDebugLog(\`[ParametricVerification] REJECTED for "\${gap.query}" -> FDC \${paramIdStr} ("\${paramName}", overlap: \${(overlap * 100).toFixed(0)}% < 30%). Falling back to candidate.\`);
        }`;

code = code.replace(secCheckSearch, secCheckReplace);

// Dynamic Poison Alias Quarantine
const quarantineBlockSearch = `          const compat = checkCategoryAndStateCompatibility(gap.query, candName);
          if (!compat.compatible) {
            addDebugLog(\`[CuratorAction] REJECTED candidate \${finalChosenId} ("\${candName}") for "\${gap.query}": \${compat.reason}\`);
            finalChosenId = null;
          }
        }`;

const quarantineBlockReplace = `          const compat = checkCategoryAndStateCompatibility(gap.query, candName);
          if (!compat.compatible) {
            addDebugLog(\`[CuratorAction] REJECTED candidate \${finalChosenId} ("\${candName}") for "\${gap.query}": \${compat.reason}\`);
            currentQuarantineList.push(finalChosenId);
            quarantinedFdcIds.add(finalChosenId);
            finalChosenId = null;
          } else {
             // Roll back alias mappings if it fails downstream checks:
             if (!await verifyId(finalChosenId, candName)) {
                addDebugLog(\`[DynamicPoisonQuarantine] REJECTED candidate \${finalChosenId} ("\${candName}"). Adding to quarantine.\`);
                currentQuarantineList.push(finalChosenId);
                quarantinedFdcIds.add(finalChosenId);
                finalChosenId = null;
             }
          }
        }`;

code = code.replace(quarantineBlockSearch, quarantineBlockReplace);


fs.writeFileSync('server_food_resolver_curator.ts', code);
