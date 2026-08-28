import fs from 'fs';
let code = fs.readFileSync('server_routes_food.ts', 'utf8');

const targetStr = `    const results = brandMatches.slice(0, 10).map((m: any) => ({
      food_id: m.dish_key || m.id || m.dish_name,
      dish_name: m.dish_name,
      chain_name: m.chain_name || m.brandOwner,
      display_name: m.dish_name,
      type: 'brand'
    }));`;

const replacement = `    const results = brandMatches.slice(0, 10).map((m: any) => ({
      food_id: m.dish_key || m.id || m.name,
      dish_name: m.dish_name || m.name,
      chain_name: m.chain_name || m.chainName || m.brandOwner,
      display_name: m.dish_name || m.name,
      type: 'brand'
    }));`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('server_routes_food.ts', code);
console.log("Fixed server_routes_food.ts mapping");
