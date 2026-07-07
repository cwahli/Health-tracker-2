const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// We want to replace handleStandardizeBiomarkerUnits
const start = code.indexOf('const handleStandardizeBiomarkerUnits = async');
const end = code.indexOf('const handleCombineBiomarkers = async');

if (start > -1 && end > -1) {
  const newFunc = `const handleStandardizeBiomarkerUnits = async (updates: { [key: string]: { unit: string; name: string } }) => {
    let hasChanges = false;
    const updatedProfile = { ...profile };
    if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};

    for (const [key, val] of Object.entries(updates)) {
      const oldCustom = updatedProfile.customBiomarkers[key] || {};
      updatedProfile.customBiomarkers[key] = {
        ...oldCustom,
        name: val.name || oldCustom.name,
        unit: val.unit
      };
      hasChanges = true;
    }

    if (hasChanges) {
      setProfile(updatedProfile);
      await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  `;
  
  code = code.substring(0, start) + newFunc + code.substring(end);
  fs.writeFileSync('src/App.tsx', code);
  console.log("Patched handleStandardizeBiomarkerUnits");
}
