const fs = require('fs');

// 1. Fix App.tsx
let appCode = fs.readFileSync('src/App.tsx', 'utf8');

// Replace signature
appCode = appCode.replace(
  "targetDef: { name: string; unit: string; normalRange: string; description: string },",
  "targetDef: any,"
);

// Replace assignment
const assignmentRegex = /updatedCustomBiomarkers\[targetKey\] = \{\s*name: targetDef\.name,\s*unit: targetDef\.unit,\s*normalRange: targetDef\.normalRange,\s*description: targetDef\.description,\s*benefitRisk: ''\s*\};/;
const newAssignment = `updatedCustomBiomarkers[targetKey] = {
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
        riskCategories: targetDef.riskCategories || [],
        potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
        benefitRisk: ''
      };`;

if (appCode.match(assignmentRegex)) {
  appCode = appCode.replace(assignmentRegex, newAssignment);
  fs.writeFileSync('src/App.tsx', appCode);
  console.log('Fixed App.tsx assignment');
} else {
  console.log('App.tsx assignment regex failed');
}

// 2. Fix BiomarkerDictionaryModal.tsx prop signature
let modalCode = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');
modalCode = modalCode.replace(
  "onCombineBiomarkers: (targetKey: string, targetDef: { name: string; unit: string; normalRange: string; description: string }, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;",
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;"
);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', modalCode);
console.log('Fixed BiomarkerDictionaryModal.tsx prop');
