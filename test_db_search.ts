import { searchUSDA } from './src/server/food/server_food_db.ts';
import { cleanQuery } from './src/server/food/server_food_analyze_helpers.ts';
import { rankAndClassifyCandidates } from './src/server/food/server_fdc_resolve.ts';

const q = 'donut malaysia matcha';
const cleanedForRank = cleanQuery(q);
const usda = [{ description: 'Donut' }, { description: 'Donut, cake' }];
let { resolveClass, bestMatch, survivors } = rankAndClassifyCandidates(cleanedForRank, usda, 85);

if (resolveClass === 'MULTI_MATCH' && survivors.length > 0 && survivors[0].score >= 115) {
  resolveClass = 'HIT_UNIQUE';
  bestMatch = survivors[0].candidate;
}
console.log(resolveClass, bestMatch);
