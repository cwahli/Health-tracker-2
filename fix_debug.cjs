const fs = require('fs');
let code = fs.readFileSync('src/utils/debugPayload.ts', 'utf8');

code = code.replace(
  '  mode?: string;',
  '  mode?: string;\n  agentType?: string;'
);

code = code.replace(
  '    mode: result.mode || job?.inputSnapshot?.mode,',
  '    mode: result.mode || job?.inputSnapshot?.mode,\n    agentType: msg?.agentType || job?.inputSnapshot?.agentType,'
);

code = code.replace(
  `  // 5. Nutrition Calculation (Source of Truth)
  const food = input.pendingFoodLog;
  if (food && typeof food === 'object') {
    lines.push(\`## 📊 Nutrition Calculation & Breakdown\`);`,
  `  // 5. Nutrition Calculation (Source of Truth)
  const food = input.pendingFoodLog;
  if (food && typeof food === 'object' && input.agentType !== 'biomarker_review' && input.mode !== 'biomarker_review') {
    lines.push(\`## 📊 Nutrition Calculation & Breakdown\`);`
);

fs.writeFileSync('src/utils/debugPayload.ts', code, 'utf8');
console.log('Fixed debugPayload.ts');
