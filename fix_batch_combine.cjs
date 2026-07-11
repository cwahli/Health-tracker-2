const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetCombine = `    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Deferred to manual sync

    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };`;

const replaceCombine = `    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Deferred to manual sync
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };`;

if(code.includes(targetCombine)) {
  code = code.split(targetCombine).join(replaceCombine);
  console.log("Updated handleBatchCombineBiomarkers");
} else {
  console.log("Could not find handleBatchCombineBiomarkers");
}

fs.writeFileSync('src/App.tsx', code);
