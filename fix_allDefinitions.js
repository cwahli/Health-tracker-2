const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf-8');

const target = `    const combined = biomarkerDefinitions.map(d => {
      return {
        ...d,
        descriptions: { ...d.descriptions }
      };
    });`;

const replacement = `    const combined = biomarkerDefinitions.filter(d => biomarkers[d.key] !== undefined).map(d => {
      return {
        ...d,
        descriptions: { ...d.descriptions }
      };
    });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
  console.log('Fixed allDefinitions');
} else {
  console.log('Target not found!');
}
