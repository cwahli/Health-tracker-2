import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

const dupRegex = /dbSource === "usda" \|\| dbSource === "matched_database_entry" \|\| dbSource === "estimated" \|\|/g;

// Only keep one instance in each block by first removing all, then adding one back, or just replacing duplicates manually.
// Actually, it's easier to just match the block.
code = code.replace(/dbSource === "brand_official" \|\|( dbSource === "usda" \|\| dbSource === "matched_database_entry" \|\| dbSource === "estimated" \|\|)+/g, 
  'dbSource === "brand_official" || dbSource === "usda" || dbSource === "matched_database_entry" || dbSource === "estimated" ||');

fs.writeFileSync('server_pure_helpers.ts', code);
console.log("Cleaned up duplicates.");
