import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

const auditLogic = `  const auditReport = useMemo(() => {
    return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, biomarkerHistory || [], biomarkers || {});
  }, [profile?.customBiomarkers, biomarkerHistory, biomarkers]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    auditReport.duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [auditReport]);`;

// Remove the old definitions
code = code.replace(auditLogic, "");

// Add them right after customKeys is defined at the top of the component
code = code.replace(
  "const customKeys = Object.keys(profile.customBiomarkers || {});",
  `const customKeys = Object.keys(profile.customBiomarkers || {});\n\n${auditLogic}`
);

fs.writeFileSync(path, code);
