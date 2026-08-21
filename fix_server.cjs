const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(/searchUSDA,\n          fetchFoodDetailsForFdcId/g, 'searchUSDA');

const targetStr = `        const fetchNutrientsForFdcId = async (fdcId: string): Promise<Record<string, number> | null> => {`;
const replaceStr = `        const fetchFoodDetailsForFdcId = async (fdcId: string): Promise<{ title: string, nutrients: Record<string, number> } | null> => {
          if (dbMatchMap.has(fdcId)) {
            const data = dbMatchMap.get(fdcId);
            return data ? { title: data.name || data.description || data.searchQuery || '', nutrients: data } : null;
          }
          if (/^\\d+$/.test(fdcId)) {
            const food = await fetchUSDAFoodById(fdcId);
            if (food) return { title: food.description || '', nutrients: extractUSDANutrientsPer100g(food) };
            if (/^\\d{6,}$/.test(fdcId)) {
              const prod = await fetchOFFProductByBarcode(fdcId);
              if (prod) return { title: prod.product_name || '', nutrients: extractOFFNutrientsPer100g(prod) };
            }
          }
          return null;
        };

        const fetchNutrientsForFdcId = async (fdcId: string): Promise<Record<string, number> | null> => {`;

if (code.includes(targetStr) && !code.includes('fetchFoodDetailsForFdcId = async (fdcId: string)')) {
  code = code.replace(targetStr, replaceStr);
}

const targetCall = `        const resolvedGaps = await executeFoodResolverCurator(
          gapsForResolver,
          addDebugLog,
          callLLMFn,
          fetchNutrientsForFdcId,
          searchUSDA
        );`;
const replaceCall = `        const resolvedGaps = await executeFoodResolverCurator(
          gapsForResolver,
          addDebugLog,
          callLLMFn,
          fetchNutrientsForFdcId,
          searchUSDA,
          fetchFoodDetailsForFdcId
        );`;

code = code.replace(targetCall, replaceCall);

fs.writeFileSync('server.ts', code);
