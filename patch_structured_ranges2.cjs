const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  `    normalRange: initialNormalRange,
      structuredRanges: customDef?.structuredRanges || [],
    structuredRanges: customDef?.structuredRanges || [],`,
  `    normalRange: initialNormalRange,
    structuredRanges: customDef?.structuredRanges || [],`
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched structuredRanges state 2");
