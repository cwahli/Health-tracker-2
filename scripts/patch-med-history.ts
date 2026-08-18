import fs from 'fs';
const path = 'src/components/MedicalHistoryTab.tsx';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('runGeneralizedBiomarkerAudit')) {
  code = code.replace(
    "import { isBiomarkerDuplicateCandidate } from '../utils/biomarkerAuditEngine';",
    "import { isBiomarkerDuplicateCandidate, runGeneralizedBiomarkerAudit } from '../utils/biomarkerAuditEngine';"
  );
  if (!code.includes('runGeneralizedBiomarkerAudit')) {
     code = code.replace(
       "import { checkBiomarkerMissingMetadata } from '../utils/biomarkerAuditEngine';",
       "import { checkBiomarkerMissingMetadata, runGeneralizedBiomarkerAudit } from '../utils/biomarkerAuditEngine';"
     );
  }
}

const hookInjection = `
  const auditReport = useMemo(() => {
    return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, activeHistory || []);
  }, [profile?.customBiomarkers, activeHistory]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    auditReport.duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [auditReport]);
`;

code = code.replace(
  "const totalUniqueBiomarkers = useMemo(() => {",
  hookInjection + "\n  const totalUniqueBiomarkers = useMemo(() => {"
);

code = code.replace(
  "return withMetadata.filter(d => !isKeyNotUsedInMedicalHistory(d.key));",
  "return withMetadata.filter(d => !isKeyNotUsedInMedicalHistory(d.key) && !aliasKeysToHide.has(d.key));"
);

fs.writeFileSync(path, code);
