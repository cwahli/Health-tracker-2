import fs from 'fs';
let code = fs.readFileSync('server_food_catalog.ts', 'utf8');

code = code.replace("if (!isSupabaseConfigured()) {", "if (!isSupabaseConfigured) {");
fs.writeFileSync('server_food_catalog.ts', code);
console.log("Fixed isSupabaseConfigured");
