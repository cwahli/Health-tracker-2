const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `const cleaned = cleanName(rawName);
        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');`;

const replace = `const cleaned = cleanName(rawName);
        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const cleanDef = { ...def };
        if (!cleanDef.unit || cleanDef.unit.trim() === '-' || cleanDef.unit.trim() === '') delete cleanDef.unit;
        if (!cleanDef.normalRange || cleanDef.normalRange.trim() === '-' || cleanDef.normalRange.trim() === '') delete cleanDef.normalRange;
        if (!cleanDef.standardMedicalGrouping || cleanDef.standardMedicalGrouping === 'Other') delete cleanDef.standardMedicalGrouping;
        if (!cleanDef.riskCategories || cleanDef.riskCategories.length === 0) delete cleanDef.riskCategories;`;

if(code.includes(target)) {
  code = code.split(target).join(replace);
  
  // also need to replace `...def,` with `...cleanDef,` in the biomarkers[rawKey] block
  const target2 = `currentCustoms[rawKey] = {
            ...(currentCustoms[rawKey] || {}),
            ...def,
            name: cleaned
          };`;
  const replace2 = `currentCustoms[rawKey] = {
            ...(currentCustoms[rawKey] || {}),
            ...cleanDef,
            name: cleaned
          };`;
  code = code.split(target2).join(replace2);
  
  console.log("Updated App.tsx customBiomarkers merge logic!");
} else {
  console.log("Could not find target");
}
fs.writeFileSync('src/App.tsx', code);
