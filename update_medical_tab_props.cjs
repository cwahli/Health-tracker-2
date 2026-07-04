const fs = require('fs');
let content = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

const target1 = `  onDeleteBiomarkerLog: (id: string) => void;`;
const replacement1 = `  onDeleteBiomarkerLog: (id: string) => void;
  onDeleteBiomarker?: (key: string) => void;`;
content = content.replace(target1, replacement1);

const target2 = `  onDeleteBiomarkerLog,
  onEditBiomarkerLog,`;
const replacement2 = `  onDeleteBiomarkerLog,
  onDeleteBiomarker,
  onEditBiomarkerLog,`;
content = content.replace(target2, replacement2);

fs.writeFileSync('src/components/MedicalHistoryTab.tsx', content);
