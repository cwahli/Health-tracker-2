const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  "standardMedicalGrouping: origMasterDef.standardMedicalGrouping || origMasterDef.medicalGrouping || masterBio?.medicalGrouping || '',",
  "standardMedicalGrouping: (origMasterDef as any).standardMedicalGrouping || (origMasterDef as any).medicalGrouping || masterBio?.medicalGrouping || '',"
);

code = code.replace(
  "riskCategories: origMasterDef.riskCategories || [],",
  "riskCategories: (origMasterDef as any).riskCategories || [],"
);

code = code.replace(
  "potentialMedicalConditions: origMasterDef.potentialMedicalConditions || [],",
  "potentialMedicalConditions: (origMasterDef as any).potentialMedicalConditions || [],"
);

code = code.replace(
  "rangeConfig: origMasterDef.rangeConfig,",
  "rangeConfig: (origMasterDef as any).rangeConfig,"
);

code = code.replace(
  "customRanges: origMasterDef.customRanges",
  "customRanges: (origMasterDef as any).customRanges"
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log('Fixed TS errors');
