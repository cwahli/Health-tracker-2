import fs from 'fs';
let code = fs.readFileSync('server_routes_food.ts', 'utf8');

code = code.replace(/  try {\n    const results = await searchFoodCatalog\(query, 5\);\n    res\.json\(\{ results \}\);\n  \} catch \(err\) {\n    res\.status\(500\)\.json\(\{ error: String\(err\) \}\);\n  \}\}\);/g, '');

fs.writeFileSync('server_routes_food.ts', code);
