const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace("const rTags = origDef.riskCategories || [];", "const rTags = (origDef as any).riskCategories || [];");
code = code.replace("const cTags = origDef.potentialMedicalConditions || [];", "const cTags = (origDef as any).potentialMedicalConditions || [];");

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log('Fixed TS error');
