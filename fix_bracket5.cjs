const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const targetIndex = code.indexOf('const RangeEditor');
console.log(code.substring(targetIndex - 20, targetIndex + 20));

const newCode = code.substring(0, targetIndex - 1) + '};\n\n' + code.substring(targetIndex);
fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', newCode);
console.log("Forced fix.");
