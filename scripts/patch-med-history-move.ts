import fs from 'fs';
const path = 'src/components/MedicalHistoryTab.tsx';
let code = fs.readFileSync(path, 'utf8');

const auditReportString = `  const auditReport = useMemo(() => {
    return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, activeHistory || []);
  }, [profile?.customBiomarkers, activeHistory]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    auditReport.duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [auditReport]);`;

// Remove the one we added earlier
code = code.replace(auditReportString, "");

// Inject it near the top, right after `activeHistory`
code = code.replace(
  "const activeHistory = useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);",
  "const activeHistory = useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);\n\n" + auditReportString
);

fs.writeFileSync(path, code);
