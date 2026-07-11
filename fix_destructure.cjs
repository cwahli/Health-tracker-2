const fs = require('fs');
let code = fs.readFileSync('src/components/InsightsTab.tsx', 'utf8');

const target = `  onDeleteAnalysis,
  onArchiveAnalysis,
  biomarkerHistory,
  onUpdateProfile,
  onUpdateHistory,`;

const replace = `  onDeleteAnalysis,
  onArchiveAnalysis,
  onDeleteBiomarker,
  onDeleteMultipleBiomarkers,
  biomarkerHistory,
  onUpdateProfile,
  onUpdateHistory,`;

if (code.includes(target)) {
  code = code.split(target).join(replace);
  fs.writeFileSync('src/components/InsightsTab.tsx', code);
  console.log("Updated InsightsTab successfully.");
} else {
  console.log("Targets not found in InsightsTab!");
}
