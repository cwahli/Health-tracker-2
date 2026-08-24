import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

const regex = /const isLabelOrScreenSource = dbSource === "label" \|\| \s*dbSource === "kiosk" \|\| \s*dbSource === "screen" \|\| \s*dbSource === "menu" \|\| \s*dbSource === "brand_official" \|\|/;

const replacement = `const isLabelOrScreenSource = dbSource === "label" || 
    dbSource === "kiosk" || 
    dbSource === "screen" || 
    dbSource === "menu" || 
    dbSource === "brand_official" ||
    dbSource === "usda" || 
    dbSource === "matched_database_entry" || 
    dbSource === "estimated" ||`;

code = code.replace(regex, replacement);

fs.writeFileSync('server_pure_helpers.ts', code);
console.log("Patched reality checks to skip all deterministic backend sources.");
