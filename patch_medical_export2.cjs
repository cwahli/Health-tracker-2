const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

const targetStr = "const rows = filteredBiomarkers.map(def => {";
const replacementStr = "const exportList = allDefinitions.filter(def => biomarkers[def.key] !== undefined || profile.customBiomarkers?.[def.key]);\n    const rows = exportList.map(def => {";

if (code.includes(targetStr)) {
  code = code.replace(targetStr, replacementStr);
  fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
  console.log("Successfully patched MedicalHistoryTab.tsx export function to include all data!");
} else {
  console.log("Target not found");
}
