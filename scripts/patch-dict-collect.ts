import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

const hookInjection = `
  const getAliasesForMaster = (k: string) => {
    const group = auditReport.duplicateGroups.find(g => g.suggestedMasterKey.toLowerCase() === k.toLowerCase());
    return group ? group.candidateAliases : [];
  };
`;

code = code.replace(
  "const collectItemLogs = (k: string) => {",
  hookInjection + "\n  const collectItemLogs = (k: string) => {"
);

const logLogicReplacement = `
    const aliases = getAliasesForMaster(k);
    biomarkerHistory.forEach(h => {
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
`;

code = code.replace(
  /biomarkerHistory\.forEach\(h => \{[\s\S]*?if \(val === undefined\) \{[\s\S]*?val = h\.biomarkers\[kLower\];[\s\S]*?foundKey = kLower;[\s\S]*?\}[\s\S]*?if \(val !== undefined/,
  logLogicReplacement + "\n      if (val !== undefined"
);

fs.writeFileSync(path, code);
