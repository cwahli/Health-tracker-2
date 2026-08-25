const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkers.ts', 'utf8');

const replacement = `  const potentialMedicalConditions = (Array.isArray(custom?.potentialMedicalConditions) && custom.potentialMedicalConditions.length > 0)
    ? custom.potentialMedicalConditions
    : (Array.isArray(centralDef?.potentialMedicalConditions) && centralDef.potentialMedicalConditions.length > 0 ? centralDef.potentialMedicalConditions : defaults.conditions);

  const category = (custom?.category && custom.category !== 'other' && custom.category !== 'wellness') 
    ? custom.category 
    : (centralDef?.category || 'other');
    
  const rangeBrackets = (Array.isArray(custom?.rangeBrackets) && custom.rangeBrackets.length > 0)
    ? custom.rangeBrackets
    : (centralDef?.rangeBrackets || []);

  const structuredRanges = (Array.isArray(custom?.structuredRanges) && custom.structuredRanges.length > 0)
    ? custom.structuredRanges
    : (centralDef?.structuredRanges || []);

  const descriptions = (custom?.descriptions && Object.keys(custom.descriptions).length > 0)
    ? custom.descriptions
    : (centralDef?.descriptions || {});

  return {
    ...centralDef,
    ...custom,
    key: k,
    name,
    unit,
    normalRange,
    standardMedicalGrouping,
    riskCategories,
    potentialMedicalConditions,
    category,
    rangeBrackets,
    structuredRanges,
    descriptions,
    needsApproval: custom?.needsApproval
  };
}`;

code = code.replace(
  /const potentialMedicalConditions = \(Array\.isArray\(custom\?\.potentialMedicalConditions\)[\s\S]*?needsApproval: custom\?\.needsApproval\s*\};\s*\}/,
  replacement
);

fs.writeFileSync('src/utils/biomarkers.ts', code);
