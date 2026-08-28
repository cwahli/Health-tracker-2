import fs from 'fs';
let code = fs.readFileSync('server_routes_food.ts', 'utf8');

const importStr = `import { searchUSDA, searchOpenFoodFacts } from './server.js';\nexport const foodRouter = Router();`;
code = code.replace("export const foodRouter = Router();", importStr);

const logicStr = `foodRouter.get('/api/food/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json({ results: [] });
  try {
    const results = await searchFoodCatalog(query, 5);
    
    // If not enough local DB results, query external APIs
    if (results.length < 3) {
      try {
        const [usda, off] = await Promise.all([
          searchUSDA(query, 2),
          searchOpenFoodFacts(query, 2)
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
    
    res.json({ results: results.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});`;

code = code.replace(/foodRouter\.get\('\/api\/food\/search'[\s\S]*?\}\);/, logicStr);

fs.writeFileSync('server_routes_food.ts', code);
console.log("Patched server_routes_food.ts");
