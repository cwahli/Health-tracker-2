const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const targetLine = 'approvalReason="Found in uploaded logs but missing a standardized dictionary definition. Please review, standardize, or approve it manually to add it to your profile."';

const replacement = `approvalReason={\`Found in uploaded logs but missing: \${[
                            !def && 'standard dictionary definition',
                            (def && !def.unit) && 'unit',
                            (def && !def.normalRange) && 'normal range',
                            (def && !def.standardMedicalGrouping) && 'medical grouping'
                          ].filter(Boolean).join(', ')}. Please review, standardize, or approve it manually.\`}`;

code = code.replace(targetLine, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched approval reason");
