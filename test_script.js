import fs from 'fs';
const data = fs.readFileSync('src/server/food/server_food_analyze_run.ts', 'utf8');
console.log("length:", data.length);
