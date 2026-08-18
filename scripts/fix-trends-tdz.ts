import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

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
  "const activeHistory = React.useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);",
  `const activeHistory = React.useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);\n\n${auditHook}`
);

fs.writeFileSync(path, code);
