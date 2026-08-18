import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

// Insert the audit report generation right before allAvailableKeys
const hookInjection = `
  const auditReport = useMemo(() => {
    return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, biomarkerHistory || []);
  }, [profile?.customBiomarkers, biomarkerHistory]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    auditReport.duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [auditReport]);
`;

code = code.replace(
  "const allAvailableKeys = useMemo(() => {",
  hookInjection + "\n  const allAvailableKeys = useMemo(() => {"
);

code = code.replace(
  "return [...toApproveKeys, ...allApprovedKeys];",
  "return [...toApproveKeys, ...allApprovedKeys].filter(k => !aliasKeysToHide.has(k));"
);

fs.writeFileSync(path, code);
