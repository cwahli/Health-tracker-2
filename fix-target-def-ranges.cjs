const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /const targetDef = \{\n\s*name: targetName,\n\s*unit: masterBio\?\.unit \|\| '',\n\s*normalRange: masterBio\?\.range \|\| '',\n\s*description: masterBio\?\.description \|\| '',\n\s*standardMedicalGrouping: origMasterDef\.standardMedicalGrouping \|\| origMasterDef\.medicalGrouping \|\| masterBio\?\.medicalGrouping \|\| '',\n\s*riskCategories: origMasterDef\.riskCategories \|\| \[\],\n\s*potentialMedicalConditions: origMasterDef\.potentialMedicalConditions \|\| \[\]\n\s*\};/;

const newCode = `const targetDef = {
          name: targetName,
          unit: masterBio?.unit || '',
          normalRange: masterBio?.range || '',
          description: masterBio?.description || '',
          standardMedicalGrouping: origMasterDef.standardMedicalGrouping || origMasterDef.medicalGrouping || masterBio?.medicalGrouping || '',
          riskCategories: origMasterDef.riskCategories || [],
          potentialMedicalConditions: origMasterDef.potentialMedicalConditions || [],
          rangeConfig: origMasterDef.rangeConfig,
          customRanges: origMasterDef.customRanges
        };`;

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log('Fixed targetDef ranges in Modal');
} else {
  console.log('Regex did not match for ranges');
}
