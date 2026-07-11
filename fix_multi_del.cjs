const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `  const handleDeleteMultipleBiomarkers = async (keys: string[]) => {
    const updatedBiomarkers = { ...biomarkers };
    keys.forEach(key => delete updatedBiomarkers[key]);
    
    const logsToDelete: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      keys.forEach(key => {
        if (cleanBiomarkers[key] !== undefined) {
          delete cleanBiomarkers[key];
          changed = true;
        }
      });
      if (changed && Object.keys(cleanBiomarkers).length === 0 && !log.note) {
        logsToDelete.push(log.id);
      }
      return changed ? { ...log, biomarkers: cleanBiomarkers } : log;
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
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      keys.forEach(key => delete newCustoms[key]);
      updatedProfile.customBiomarkers = newCustoms;
    }
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };`;

const replace = `  const handleDeleteMultipleBiomarkers = async (keys: string[]) => {
    const updatedBiomarkers = { ...biomarkers };
    keys.forEach(key => delete updatedBiomarkers[key]);
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      keys.forEach(key => {
        if (cleanBiomarkers[key] !== undefined) {
          delete cleanBiomarkers[key];
          changed = true;
        }
      });
      if (changed) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
        } else {
          logsToUpdate.push(log.id);
        }
      }
      return changed ? { ...log, biomarkers: cleanBiomarkers } : log;
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
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      keys.forEach(key => delete newCustoms[key]);
      updatedProfile.customBiomarkers = newCustoms;
    }
    setProfile(updatedProfile);
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };`;

if(code.includes(target)) {
  code = code.split(target).join(replace);
  console.log("Updated handleDeleteMultipleBiomarkers");
} else {
  console.log("Could not find handleDeleteMultipleBiomarkers");
}

fs.writeFileSync('src/App.tsx', code);
