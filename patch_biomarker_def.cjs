const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkers.ts', 'utf8');

code = code.replace(
  '  normalRange: string;',
  '  normalRange: string;\n  structuredRanges?: any[];'
);

fs.writeFileSync('src/utils/biomarkers.ts', code);
console.log("Patched BiomarkerDefinition");
