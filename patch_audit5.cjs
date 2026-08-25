const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

const replacement = `    const isMatched = !!catalogMatchDef;
    const isCategoryMissing = (!def.category || def.category === 'other' || def.category === 'wellness' || !def.standardMedicalGrouping || def.standardMedicalGrouping === 'Other' || isRiskCategoryMissing || isConditionsMissing) && !isMatched;
    const isBracketsMissing = false; // We no longer strictly require detailed brackets if the catalog doesn't provide them, aligning with isBiomarkerApproved
    const isDescriptionMissing = false; // Aligning with isBiomarkerApproved which doesn't strictly check descriptions
    
    if (isRangeMissing || isCategoryMissing) {`;

code = code.replace(
  /const isMatched = !!catalogMatchDef;\s*const isCategoryMissing = \(\!def\.category \|\| def\.category === 'other' \|\| def\.category === 'wellness' \|\| \!def\.standardMedicalGrouping \|\| def\.standardMedicalGrouping === 'Other' \|\| isRiskCategoryMissing \|\| isConditionsMissing\) && \!isMatched;\s*const isBracketsMissing = false;[\s\S]*?if \(isRangeMissing \|\| isCategoryMissing\) \{/g,
  replacement
);

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', code);
