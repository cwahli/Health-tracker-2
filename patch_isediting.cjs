const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const targetStr = 'onClick={() => setIsEditing(true)}';

const replacement = `onClick={() => {
                    setEditState({
                      key: itemKey,
                      name: initialName,
                      unit: initialUnit,
                      normalRange: initialNormalRange,
                      structuredRanges: customDef?.structuredRanges || builtInDef?.structuredRanges || [],
                      standardMedicalGrouping: initialGrouping,
                      riskCategories: initialRisk,
                      potentialMedicalConditions: initialConditions
                    });
                    setIsEditing(true);
                  }}`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched setIsEditing");
