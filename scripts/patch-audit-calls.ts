import fs from 'fs';

let path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  "return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, biomarkerHistory || []);",
  "return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, biomarkerHistory || [], biomarkers || {});"
);
code = code.replace(
  "}, [profile?.customBiomarkers, biomarkerHistory]);",
  "}, [profile?.customBiomarkers, biomarkerHistory, biomarkers]);"
);
fs.writeFileSync(path, code);

path = 'src/components/BiomarkerAuditModal.tsx';
code = fs.readFileSync(path, 'utf8');
code = code.replace(
  "return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, biomarkerHistory || []);",
  "return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, biomarkerHistory || [], (profile as any)?.currentBiomarkers || {});"
);
fs.writeFileSync(path, code);

path = 'src/components/MedicalHistoryTab.tsx';
code = fs.readFileSync(path, 'utf8');
code = code.replace(
  "return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, activeHistory || []);",
  "return runGeneralizedBiomarkerAudit(profile?.customBiomarkers || {}, activeHistory || [], biomarkers || {});"
);
code = code.replace(
  "}, [profile?.customBiomarkers, activeHistory]);",
  "}, [profile?.customBiomarkers, activeHistory, biomarkers]);"
);
fs.writeFileSync(path, code);
