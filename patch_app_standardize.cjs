const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  'name: val.name || oldCustom.name,\n        unit: val.unit\n      };',
  'name: val.name || oldCustom.name,\n        unit: val.unit,\n        standardMedicalGrouping: oldCustom.standardMedicalGrouping || "By Medical Practice"\n      };'
);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx");
