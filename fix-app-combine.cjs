const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /const isStandard = biomarkerDefinitions\.some\(d => d\.key === targetKey\);\n\s*if \(\!isStandard\) \{\n\s*updatedCustomBiomarkers\[targetKey\] = \{\n\s*name: targetDef\.name,\n\s*unit: targetDef\.unit,\n\s*normalRange: targetDef\.normalRange,\n\s*description: targetDef\.description,\n\s*standardMedicalGrouping: targetDef\.standardMedicalGrouping \|\| '',\n\s*riskCategories: targetDef\.riskCategories \|\| \[\],\n\s*potentialMedicalConditions: targetDef\.potentialMedicalConditions \|\| \[\],\n\s*benefitRisk: ''\n\s*\};\n\s*\}/;

const newCode = `const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
    const existingCustom = profile?.customBiomarkers?.[targetKey];
    
    updatedCustomBiomarkers[targetKey] = {
      ...(builtIn || {}),
      ...(existingCustom || {}),
      name: targetDef.name,
      unit: targetDef.unit,
      normalRange: targetDef.normalRange,
      description: targetDef.description,
      standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
      riskCategories: targetDef.riskCategories || [],
      potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
    };`;

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Fixed App.tsx combine logic');
} else {
  console.log('App.tsx combine regex did not match');
}
