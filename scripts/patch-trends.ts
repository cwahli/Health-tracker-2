import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

const auditImport = `import { runGeneralizedBiomarkerAudit } from '../utils/biomarkerAuditEngine';`;
if (!code.includes(auditImport)) {
  code = code.replace("import { getBiomarkerStatus", `${auditImport}\nimport { getBiomarkerStatus`);
}

const auditHook = `  const auditReport = useMemo(() => {
    return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, activeHistory || [], (profile as any)?.currentBiomarkers || {});
  }, [profile?.customBiomarkers, activeHistory, profile]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    auditReport.duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [auditReport]);`;

code = code.replace(
  "const activeHistory = useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);",
  `const activeHistory = useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);\n\n${auditHook}`
);

// Update getChartData to check aliases
const searchStr = `const ldlVal = dayBio?.biomarkers.ldl;
      const hba1cVal = dayBio?.biomarkers.hba1c;
      const egfrVal = dayBio?.biomarkers.egfr;`;

const replacement = `const getBioVal = (k: string) => {
        if (!dayBio?.biomarkers) return undefined;
        if (dayBio.biomarkers[k] !== undefined) return dayBio.biomarkers[k];
        const aliases = auditReport.duplicateGroups.find(g => g.suggestedMasterKey === k)?.candidateAliases || [];
        for (const alias of aliases) {
          if (dayBio.biomarkers[alias] !== undefined) return dayBio.biomarkers[alias];
        }
        return undefined;
      };
      
      const ldlVal = getBioVal('ldl');
      const hba1cVal = getBioVal('hba1c');
      const egfrVal = getBioVal('egfr');`;

code = code.replace(searchStr, replacement);

fs.writeFileSync(path, code);
