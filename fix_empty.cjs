const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetEmpty = `    if (modifiedProfile) setProfile(updatedProfile);
    if (modifiedBiomarkers) setBiomarkers(recomputedBiomarkers);
    setBiomarkerHistory(updatedHistory);

// Sync deferred to manual button click

    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };`;

const replaceEmpty = `    if (modifiedProfile) setProfile(updatedProfile);
    if (modifiedBiomarkers) setBiomarkers(recomputedBiomarkers);
    setBiomarkerHistory(updatedHistory);

// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate.map(l => l.id) });
    } else {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };`;

if(code.includes(targetEmpty)) {
  code = code.split(targetEmpty).join(replaceEmpty);
  console.log("Updated handleDeleteEmptyBiomarkers");
} else {
  console.log("Could not find handleDeleteEmptyBiomarkers");
}

fs.writeFileSync('src/App.tsx', code);
