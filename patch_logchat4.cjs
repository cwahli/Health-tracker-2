const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetIf = `      } else if (type === 'food_idea') {`;
const replacementIf = `      } else if (type === 'daily_recommendation') {
        bodyData.foodLogs = (foodLogs || []).map(f => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
        bodyData.biomarkers = biomarkers;
        bodyData.report = report;
        bodyData.actions = actions;
        bodyData.steps = googleSteps;
        bodyData.location = loc;
      } else if (type === 'food_idea') {`;
code = code.replace(targetIf, replacementIf);

fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched LogChat branch");
