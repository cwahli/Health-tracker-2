import fs from 'fs';
const path = 'src/components/MedicalHistoryTab.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  '<span>Total Unique Biomarkers: <strong',
  '<span>Tracked Biomarkers: <strong'
);

fs.writeFileSync(path, code);
