const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
const target = `    await submitServerJob({
      ...req.body,
      jobId,
      userId: userId || 'anonymous',
      kind,
      mode,
      text,
      images,
      imageUrls,
      history,
      userProfile,
      engine,
      biomarkersNeedingImprovement,
      remainingAllowance,
      activeMeal,
      foodLogs,
      userSelectedMode,
      activeScoutItems
    });`;
const replacement = `    await submitServerJob({
      ...req.body,
      jobId,
      userId: userId || 'anonymous',
    });`;
if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('server.ts', code);
  console.log('Patched server.ts');
} else {
  console.log('Target not found');
}
