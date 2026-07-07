const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldRegex1 = `const bracketMatch = val.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)$/);`;
const newRegex1 = `const bracketMatch = val.match(/^([\\d.]+)\\s*-\\s*([\\d.]+)(?:\\s+.*)?$/);`;

const oldRegex2 = `const lessMatch = val.match(/^<\\s*([\\d.]+)$/);`;
const newRegex2 = `const lessMatch = val.match(/^(?:<|<=|under|less than|below)\\s*([\\d.]+)(?:\\s+.*)?$/i);`;

const oldRegex3 = `const greaterMatch = val.match(/^>\\s*([\\d.]+)$/);`;
const newRegex3 = `const greaterMatch = val.match(/^(?:>|>=|over|greater than|above)\\s*([\\d.]+)(?:\\s+.*)?$/i);`;

code = code.replace(oldRegex1, newRegex1);
code = code.replace(oldRegex2, newRegex2);
code = code.replace(oldRegex3, newRegex3);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal regex");
