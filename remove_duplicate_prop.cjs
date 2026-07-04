const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');

const target = `            onUpdateHistory={async (newHistory, newBiomarkers) => {
              setBiomarkerHistory(newHistory);
              setBiomarkers(newBiomarkers);
              await saveAndSync(profile, foodLogs, newBiomarkers, newHistory, actions, dailyBenefits, report);
            }}`;

app = app.replace(target, '');
fs.writeFileSync('src/App.tsx', app);
