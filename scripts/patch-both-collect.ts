import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

// The replacement logic:
const logLogicReplacement = `
    const aliases = auditReport?.duplicateGroups?.find((g: any) => g.suggestedMasterKey.toLowerCase() === k.toLowerCase())?.candidateAliases || [];
    biomarkerHistory.forEach((h: any) => {
      if (!h.biomarkers) return;
      let val = h.biomarkers[k];
      let foundKey = k;
      if (val === undefined) {
        val = h.biomarkers[kLower];
        foundKey = kLower;
      }
      if (val === undefined) {
        for (const alias of aliases) {
          if (h.biomarkers[alias] !== undefined) {
            val = h.biomarkers[alias];
            foundKey = alias;
            break;
          }
        }
      }
      if (val !== undefined && val !== null && val !== '' && !Number.isNaN(val)) {
`;

// Replace all instances of collectItemLogs logic
const regex = /const collectItemLogs = \(k: string\) => \{[\s\S]*?const result: any\[\] = \[\];[\s\S]*?biomarkerHistory\.forEach\((h: any|h) => \{[\s\S]*?if \(!h\.biomarkers\) return;[\s\S]*?let val = h\.biomarkers\[k\];[\s\S]*?let foundKey = k;[\s\S]*?if \(val === undefined\) \{[\s\S]*?val = h\.biomarkers\[kLower\];[\s\S]*?foundKey = kLower;[\s\S]*?\}[\s\S]*?if \(.*?val.*?\).*?\{/g;

code = code.replace(regex, (match) => {
  return "const collectItemLogs = (k: string) => {\n    const kLower = k.toLowerCase();\n    const result: any[] = [];" + logLogicReplacement;
});

// We need to pass auditReport to BatchCalibrationModal if it doesn't have it.
code = code.replace(
  "const BatchCalibrationModal: React.FC<{",
  "const BatchCalibrationModal: React.FC<{\n  auditReport?: any;"
);
code = code.replace(
  "onConfirm\n}) => {",
  "onConfirm,\n  auditReport\n}) => {"
);
code = code.replace(
  "<BatchCalibrationModal\n            isOpen={showCalibrationModal}",
  "<BatchCalibrationModal\n            isOpen={showCalibrationModal}\n            auditReport={auditReport}"
);

// We need to ensure we don't have duplicated getAliasesForMaster since we use inline now
code = code.replace(/const getAliasesForMaster =[\s\S]*?\];\n  \};\n/g, "");

fs.writeFileSync(path, code);
