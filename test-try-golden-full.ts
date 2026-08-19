import { resolveInternalFood } from './server_food_catalog.js';

async function run() {
  const queries = [
    "plain Greek yogurt",
    "baked granola",
    "mixed berries",
    "flour tortilla wrap",
    "cooked falafel",
    "hummus",
    "feta cheese",
    "mixed salad greens",
    "garlic mayonnaise dressing",
    "grilled chicken breast",
    "raw avocado",
    "hard boiled egg",
    "butter croissant"
  ];
  for (const q of queries) {
    const res = await resolveInternalFood(q);
    console.log(q, '->', res?.fdc_id, res?.source);
  }
}
run();
