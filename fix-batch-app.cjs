const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const oldBatchEnd = `    const updatedProfile: UserProfile = {
      ...profile as any,
      customBiomarkers: updatedCustomBiomarkers
    };

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
  };`;

const newBatchEnd = `    const updatedProfile: UserProfile = {
      ...profile as any,
      customBiomarkers: updatedCustomBiomarkers
    };

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'multi' });
  };`;

if (code.includes(oldBatchEnd)) {
  code = code.replace(oldBatchEnd, newBatchEnd);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Fixed App.tsx');
} else {
  console.log('Could not find oldBatchEnd in App.tsx');
}
