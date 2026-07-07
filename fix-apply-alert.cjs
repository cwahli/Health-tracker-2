const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

code = code.replace(
  "alert(\"Biomarkers consolidated successfully!\");\n      setIsNameConsolidationMode(false);",
  "setIsNameConsolidationMode(false);"
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log('Fixed apply alert');
