const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const targetIndex = code.indexOf('export const BiomarkerRangeBuilder');
console.log(code.substring(targetIndex - 20, targetIndex + 30));

const newCode = code.substring(0, targetIndex - 1) + '};\n\n' + code.substring(targetIndex);
fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', newCode);

