const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target1 = `            onApplyCalculation={handleApplyCalculation}`;
const replacement1 = `            onApplyCalculation={handleApplyCalculation}
            onUpdateReport={async (updatedReport) => {
              setReport(updatedReport);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, updatedReport, { type: 'report' });
            }}`;

code = code.replace(target1, replacement1);
fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx");
