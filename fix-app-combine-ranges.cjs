const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /name: targetDef\.name,\n\s*unit: targetDef\.unit,\n\s*normalRange: targetDef\.normalRange,\n\s*description: targetDef\.description,\n\s*standardMedicalGrouping: targetDef\.standardMedicalGrouping \|\| '',\n\s*riskCategories: targetDef\.riskCategories \|\| \[\],\n\s*potentialMedicalConditions: targetDef\.potentialMedicalConditions \|\| \[\],\n\s*\};\n\s*const updatedProfile/;

const newCode = `name: targetDef.name,
      unit: targetDef.unit,
      normalRange: targetDef.normalRange,
      description: targetDef.description,
      standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
      riskCategories: targetDef.riskCategories || [],
      potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
      ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
      ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
    };
    const updatedProfile`;

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Fixed App.tsx combine logic ranges');
} else {
  console.log('App.tsx combine regex did not match ranges');
}
