import { lookupCanonicalBaseFood } from './server_food_db.js';

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
  "mixed salad greens",
  "grilled chicken breast",
  "raw avocado",
  "hard boiled egg",
  "butter croissant"
];
for (const q of queries) {
  const hit = lookupCanonicalBaseFood(q);
  console.log(q, '->', hit?.fdcId);
}
