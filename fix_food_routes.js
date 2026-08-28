import fs from 'fs';
let code = fs.readFileSync('server_routes_food.ts', 'utf8');

const targetStr = `  try {
    const results = await searchFoodCatalog(query, 5);
        
    // If not enough local DB results, query external APIs
    if (results.length < 3) {
      try {
        const [usda, off] = await Promise.all([
          searchUSDA(query, 5),
          searchOpenFoodFacts(query, 5)
        ]);
        
        // Map USDA
        usda.forEach(u => {
           results.push({
             food_id: String(u.fdcId),
             display_name: (u.brandOwner ? u.brandOwner + ' ' : '') + u.description,
             type: 'food'
           });
        });
        
        // Map OFF
        off.forEach(o => {
           results.push({
             food_id: String(o.id || o.code),
             display_name: (o.brands ? o.brands.split(',')[0] + ' ' : '') + o.product_name,
             type: 'food'
           });
        });
      } catch (e) {
        console.error('[External Search Error]', e);
      }
    }
        
    res.json({ results: results.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});`;

code = code.replace(targetStr, "");
fs.writeFileSync('server_routes_food.ts', code);
console.log("Fixed server_routes_food.ts");
