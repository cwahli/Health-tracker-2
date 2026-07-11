const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetDelete = `  const handleDeleteBiomarker = async (key: string) => {
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    
    const logsToDelete: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      if (cleanBiomarkers[key] !== undefined) {
        delete cleanBiomarkers[key];
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
        }
      }
      return { ...log, biomarkers: cleanBiomarkers };
    });
    
    updatedHistory = updatedHistory.filter(log => !logsToDelete.includes(log.id));
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = [
        ...(updatedProfile.deletedBiomarkerLogIds || []),
        ...logsToDelete
      ];
    }
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
    }
    setProfile(updatedProfile);
// Sync deferred to manual button click
    await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };`;

const replaceDelete = `  const handleDeleteBiomarker = async (key: string) => {
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      if (cleanBiomarkers[key] !== undefined) {
        delete cleanBiomarkers[key];
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
        } else {
          logsToUpdate.push(log.id);
        }
      }
      return { ...log, biomarkers: cleanBiomarkers };
    });
    
    updatedHistory = updatedHistory.filter(log => !logsToDelete.includes(log.id));
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = [
        ...(updatedProfile.deletedBiomarkerLogIds || []),
        ...logsToDelete
      ];
    }
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
    }
    setProfile(updatedProfile);
// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };`;

if(code.includes(targetDelete)) {
  code = code.split(targetDelete).join(replaceDelete);
  console.log("Updated handleDeleteBiomarker");
} else {
  console.log("Could not find handleDeleteBiomarker");
}

fs.writeFileSync('src/App.tsx', code);
