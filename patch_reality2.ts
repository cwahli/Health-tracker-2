import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

const target = `  const isLabelOrScreenSource = dbSource === "label" || 
    dbSource === "kiosk" || 
    dbSource === "screen" || 
    dbSource === "menu" || 
    dbSource === "brand_official" ||`;

const replacement = `  const isLabelOrScreenSource = dbSource === "label" || 
    dbSource === "kiosk" || 
    dbSource === "screen" || 
    dbSource === "menu" || 
    dbSource === "brand_official" ||
    dbSource === "usda" || 
    dbSource === "matched_database_entry" || 
    dbSource === "estimated" ||`;

code = code.replace(target, replacement);

fs.writeFileSync('server_pure_helpers.ts', code);
console.log("Patched reality checks (string replace).");
