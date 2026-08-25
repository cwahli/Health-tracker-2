const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

// I will just use regex to remove the map blocks for riskCategories and potentialMedicalConditions
const replaced = code.replace(
  /\{\s*def\.riskCategories\s*&&\s*def\.riskCategories\.length\s*>\s*0\s*&&\s*def\.riskCategories\.map\([^)]*\)\s*=>\s*\(\s*<span[^>]*>\s*\{catName\}\s*<\/span>\s*\)\)\s*\}/g,
  ''
).replace(
  /\{\s*def\.potentialMedicalConditions\s*&&\s*def\.potentialMedicalConditions\.length\s*>\s*0\s*&&\s*def\.potentialMedicalConditions\.map\([^)]*\)\s*=>\s*\(\s*<span[^>]*>\s*\{cond\}\s*<\/span>\s*\)\)\s*\}/g,
  ''
);

if (code !== replaced) {
  fs.writeFileSync('src/components/MedicalHistoryTab.tsx', replaced);
  console.log('Successfully removed tags from MedicalHistoryTab.tsx');
} else {
  console.log('Regex replace did not match anything.');
}
