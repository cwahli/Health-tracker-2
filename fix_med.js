const fs = require('fs');
let med = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

med = med.replace(/        \}\); \} else if \(typeof def\.riskCategories === 'string'\) \{ allRisks\.add\(def\.riskCategories\); \}/g, '        });');
med = med.replace(/if \(Array\.isArray\(def\.riskCategories\)\) \{ def\.riskCategories\.forEach\(r => \{/g, 'def.riskCategories?.forEach(r => {');

fs.writeFileSync('src/components/MedicalHistoryTab.tsx', med);
