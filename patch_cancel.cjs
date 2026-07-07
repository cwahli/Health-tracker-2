const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  `    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      standardMedicalGrouping: initialGrouping,`,
  `    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      structuredRanges: customDef?.structuredRanges || [],
      standardMedicalGrouping: initialGrouping,`
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched cancel state");
