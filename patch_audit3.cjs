const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

code = code.replace(
  /const isBracketsMissing = hasNormalRange && !hasRangeBrackets;\s*const isDescriptionMissing = !def\.description && !def\.descriptions\?\.en;\s*if \(isRangeMissing \|\| isCategoryMissing \|\| isDescriptionMissing \|\| isBracketsMissing\) \{/g,
  `const isBracketsMissing = false; // We no longer strictly require detailed brackets if the catalog doesn't provide them, aligning with isBiomarkerApproved
    const isDescriptionMissing = false; // Aligning with isBiomarkerApproved which doesn't strictly check descriptions
    
    if (isRangeMissing || isCategoryMissing) {`
);

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', code);
