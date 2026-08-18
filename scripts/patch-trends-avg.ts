import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

const searchStr2 = `Object.keys(b.biomarkers).forEach(k => allBioKeys.add(k));`;
const repl2 = `Object.keys(b.biomarkers).forEach(k => {
        if (!aliasKeysToHide.has(k)) {
          allBioKeys.add(k);
        } else {
          const master = auditReport.duplicateGroups.find(g => g.candidateAliases.includes(k))?.suggestedMasterKey;
          if (master) allBioKeys.add(master);
        }
      });`;
code = code.replace(searchStr2, repl2);

const searchStr3 = `const v = log.biomarkers[k];`;
const repl3 = `let v = log.biomarkers[k];
        if (v === undefined) {
          const aliases = auditReport.duplicateGroups.find(g => g.suggestedMasterKey === k)?.candidateAliases || [];
          for (const alias of aliases) {
            if (log.biomarkers[alias] !== undefined) {
              v = log.biomarkers[alias];
              break;
            }
          }
        }`;
code = code.replace(searchStr3, repl3);

fs.writeFileSync(path, code);
