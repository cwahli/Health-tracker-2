import fs from 'fs';
const path = 'src/utils/biomarkerAuditEngine.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "export function runGeneralizedBiomarkerAudit(\n  customBiomarkers: { [key: string]: any } = {},\n  biomarkerHistory: any[] = []\n): BiomarkerAuditReport {",
  "export function runGeneralizedBiomarkerAudit(\n  customBiomarkers: { [key: string]: any } = {},\n  biomarkerHistory: any[] = [],\n  currentBiomarkers: { [key: string]: any } = {}\n): BiomarkerAuditReport {"
);

code = code.replace(
  "const logCounts = countLogsByBiomarker(biomarkerHistory);",
  "const combinedHistory = [...biomarkerHistory];\n  if (currentBiomarkers && Object.keys(currentBiomarkers).length > 0) {\n    combinedHistory.push({ date: new Date().toISOString().split('T')[0], biomarkers: currentBiomarkers });\n  }\n  const logCounts = countLogsByBiomarker(combinedHistory);"
);

// We also need to fix `logCounts` usages or anything else in the audit engine.
// Actually, using `combinedHistory` instead of `biomarkerHistory` everywhere in the function is better.
code = code.replace(
  /biomarkerHistory\.forEach/g,
  "combinedHistory.forEach"
);

fs.writeFileSync(path, code);
