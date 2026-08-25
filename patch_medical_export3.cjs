const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

code = code.replace(
  'const desc = def.descriptions?.en || def.description || customDef?.descriptions?.en || customDef?.description || \'\';',
  'const desc = def.descriptions?.en || (def as any).description || customDef?.descriptions?.en || (customDef as any)?.description || \'\';'
);

fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
console.log("Patched description error.");
