import fs from 'fs';
let code = fs.readFileSync('server_routes_food.ts', 'utf8');

code = code.replace(/searchUSDA\(query, 2\),/g, 'searchUSDA(query, 5),');
code = code.replace(/searchOpenFoodFacts\(query, 2\)/g, 'searchOpenFoodFacts(query, 5)');
code = code.replace(/results\.slice\(0, 5\)/g, 'results.slice(0, 10)');

fs.writeFileSync('server_routes_food.ts', code);
