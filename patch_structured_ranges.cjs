const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

// 1. Add structuredRanges to editState
code = code.replace(
  'normalRange: initialNormalRange,',
  `normalRange: initialNormalRange,\n    structuredRanges: customDef?.structuredRanges || [],`
);

code = code.replace(
  'normalRange: editState.normalRange.trim(),',
  `normalRange: editState.normalRange.trim(),\n      structuredRanges: editState.structuredRanges,`
);

code = code.replace(
  'normalRange: initialNormalRange,',
  `normalRange: initialNormalRange,\n      structuredRanges: customDef?.structuredRanges || [],`
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched structuredRanges state");
