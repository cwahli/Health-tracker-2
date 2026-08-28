import fs from 'fs';
let code = fs.readFileSync('server_routes_food.ts', 'utf8');

const targetStr = `foodRouter.get('/api/food/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json({ results: [] });
  try {
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
    console.error('[Search Error]', err);
    res.status(500).json({ results: [] });
  }
});`;

const replacement = `import { searchBrandMenuItems } from './serverBrandMenu.js';
foodRouter.get('/api/food/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json({ results: [] });
  try {
    const brandMatches = await searchBrandMenuItems(query);
    const results = brandMatches.slice(0, 5).map(m => ({
      food_id: m.dish_key || m.id,
      dish_name: m.dish_name,
      chain_name: m.chain_name || m.brandOwner,
      display_name: m.dish_name,
      type: 'brand'
    }));
    res.json({ results });
  } catch (err) {
    console.error('[Search Error]', err);
    res.status(500).json({ results: [] });
  }
});`;

// Because the original string might not match perfectly due to imports or formatting, we use regex.
const replaceSearch = (content) => {
  const r = /foodRouter\.get\('\/api\/food\/search',[\s\S]*?\}\);/;
  return content.replace(r, `foodRouter.get('/api/food/search', async (req, res) => {\n  const query = req.query.q as string;\n  if (!query) return res.json({ results: [] });\n  try {\n    const { searchBrandMenuItems } = await import('./serverBrandMenu.js');\n    const brandMatches = await searchBrandMenuItems(query);\n    const results = brandMatches.slice(0, 10).map((m: any) => ({\n      food_id: m.dish_key || m.id || m.dish_name,\n      dish_name: m.dish_name,\n      chain_name: m.chain_name || m.brandOwner,\n      display_name: m.dish_name,\n      type: 'brand'\n    }));\n    res.json({ results });\n  } catch (err) {\n    console.error('[Search Error]', err);\n    res.status(500).json({ results: [] });\n  }\n});`);
};

const newCode = replaceSearch(code);
if(newCode !== code) {
  fs.writeFileSync('server_routes_food.ts', newCode);
  console.log('Patched /api/food/search successfully');
} else {
  console.log('Regex did not match');
}
