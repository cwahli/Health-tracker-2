const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const targetStr = "updatedCustom[k] = { name: k, unit: '', normalRange: '', description: '' };";
const replacement = "updatedCustom[k] = { name: k, unit: '', normalRange: '', description: '', standardMedicalGrouping: 'By Medical Practice' };";

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched Approve Selected");
