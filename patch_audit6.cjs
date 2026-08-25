const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

code = code.replace(
  /const isRangeMissing = !hasNormalRange && !hasRangeBrackets;/g,
  `const isRangeMissing = (!hasNormalRange && !hasRangeBrackets) && !catalogMatchDef;`
);

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', code);
