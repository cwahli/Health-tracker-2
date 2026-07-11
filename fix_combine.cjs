const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetCombine = `    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Sync deferred to manual button click

    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };`;

const replaceCombine = `    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Sync deferred to manual button click
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };`;

if(code.includes(targetCombine)) {
  code = code.split(targetCombine).join(replaceCombine);
  console.log("Updated handleCombineBiomarkers");
} else {
  console.log("Could not find handleCombineBiomarkers");
}

fs.writeFileSync('src/App.tsx', code);
