const fs = require('fs');
const content = fs.readFileSync('server_food_db.ts', 'utf8');
const replace = "if (normalized.includes('cucumber')) return CANONICAL_BASE_FOODS.cucumber;";
const search = `if (normalized.includes('cucumber')) return CANONICAL_BASE_FOODS.cucumber;
  if (normalized.includes('tortilla')) return CANONICAL_BASE_FOODS.flour_tortilla;
  if (normalized.includes('chicken tender') || normalized.includes('chicken strip')) return CANONICAL_BASE_FOODS.breaded_chicken_tender;
  if (normalized.includes('mixed salad') || normalized.includes('salad greens')) return CANONICAL_BASE_FOODS.mixed_salad_greens;`;
fs.writeFileSync('server_food_db.ts', content.replace(search, replace));
