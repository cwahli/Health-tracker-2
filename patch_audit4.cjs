const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

const replacement = `    // If this is a perfect catalog match, and the catalog genuinely has "other" or missing risk categories, we shouldn't punish the user in an infinite loop.
    const isMatched = !!catalogMatchDef;
    const isCategoryMissing = (!def.category || def.category === 'other' || def.category === 'wellness' || !def.standardMedicalGrouping || def.standardMedicalGrouping === 'Other' || isRiskCategoryMissing || isConditionsMissing) && !isMatched;`;

code = code.replace(
  /const isCategoryMissing = !def\.category \|\| def\.category === 'other' \|\| def\.category === 'wellness' \|\| def\.needsApproval \|\| !def\.standardMedicalGrouping \|\| def\.standardMedicalGrouping === 'Other' \|\| isRiskCategoryMissing \|\| isConditionsMissing;/g,
  replacement
);

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', code);
