import fs from 'fs';
const path = 'src/utils/biomarkerAuditEngine.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "  const logCounts: { [key: string]: number } = {};",
  "  const combinedHistory = [...biomarkerHistory];\n  if (currentBiomarkers && Object.keys(currentBiomarkers).length > 0) {\n    combinedHistory.push({ date: new Date().toISOString().split('T')[0], biomarkers: currentBiomarkers });\n  }\n  const logCounts: { [key: string]: number } = {};"
);

fs.writeFileSync(path, code);
