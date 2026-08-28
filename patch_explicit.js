import fs from 'fs';
let code = fs.readFileSync('server_routes_food_analyze.ts', 'utf8');

const target = `    // Clean and consolidate queries first
    const uniqueQueries = buildFoodSearchQuerySet(visionScoutItems || []);`;
const replace = `    if (Array.isArray(req.body.explicitFoodTags) && req.body.explicitFoodTags.length > 0) {
      req.body.explicitFoodTags.forEach((tag: any, idx: number) => {
        const existing = visionScoutItems.find((vi: any) => vi.dbId === tag.dbId || vi.keyword === tag.name);
        if (!existing) {
          visionScoutItems.push({
             scoutIndex: 1000 + idx, // unique offset
             keyword: tag.name,
             originalName: tag.name,
             estimatedWeightGrams: tag.weightGrams,
             source: 'catalog_tag',
             dbId: tag.dbId,
             dbSource: 'internal_catalog',
          });
        }
      });
      addDebugLog(\`[Explicit Food Tags] Injected \${req.body.explicitFoodTags.length} catalog tags directly into vision items.\`);
    }

    // Clean and consolidate queries first
    const uniqueQueries = buildFoodSearchQuerySet(visionScoutItems || []);`;

code = code.replace(target, replace);
fs.writeFileSync('server_routes_food_analyze.ts', code);
console.log("Patched explicitFoodTags in server_routes_food_analyze.ts");
