const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /const targetDef = \{\s*name: targetName,\s*unit: masterBio\?\.unit \|\| '',\s*normalRange: masterBio\?\.range \|\| '',\s*description: masterBio\?\.description \|\| ''\s*\};/;
const newCode = `const origMasterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {};
        const targetDef = {
          name: targetName,
          unit: masterBio?.unit || '',
          normalRange: masterBio?.range || '',
          description: masterBio?.description || '',
          standardMedicalGrouping: origMasterDef.standardMedicalGrouping || origMasterDef.medicalGrouping || masterBio?.medicalGrouping || '',
          riskCategories: origMasterDef.riskCategories || [],
          potentialMedicalConditions: origMasterDef.potentialMedicalConditions || []
        };`;

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log('Fixed targetDef in Modal');
} else {
  console.log('Regex did not match in modal');
}
