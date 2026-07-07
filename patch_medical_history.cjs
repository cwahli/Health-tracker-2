const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

code = code.replace(
  'existing.name = def.name || existing.name; existing.normalRange = def.normalRange || existing.normalRange;',
  'existing.name = def.name || existing.name; existing.normalRange = def.normalRange || existing.normalRange;\n            existing.structuredRanges = def.structuredRanges || existing.structuredRanges;'
);

code = code.replace(
  `            normalRange: def.normalRange || '',
            descriptions: { en: def.description || '' },`,
  `            normalRange: def.normalRange || '',
            structuredRanges: def.structuredRanges || [],
            descriptions: { en: def.description || '' },`
);

// We should also patch the bmi case
code = code.replace(
  `            existing.descriptions = {
              ...existing.descriptions,
              en: 'A measure of body fat based on height and weight.'
            };`,
  `            existing.descriptions = {
              ...existing.descriptions,
              en: 'A measure of body fat based on height and weight.'
            };
            existing.structuredRanges = def.structuredRanges || existing.structuredRanges;`
);

fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
console.log("Patched MedicalHistoryTab merge logic");
