const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');

const handleDeleteBiomarkerLogTarget = `  const handleDeleteBiomarkerLog = async (id: string) => {`;
const handleDeleteBiomarkerCode = `  const handleDeleteBiomarker = async (key: string) => {
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    setBiomarkers(updatedBiomarkers);

    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      delete cleanBiomarkers[key];
      return {
        ...log,
        biomarkers: cleanBiomarkers
      };
    });
    updatedHistory = updatedHistory.filter(log => Object.keys(log.biomarkers).length > 0 || log.note);
    setBiomarkerHistory(updatedHistory);

    const updatedProfile = { ...profile };
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
      setProfile(updatedProfile);
    }

    await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report);
  };

  const handleDeleteBiomarkerLog = async (id: string) => {`;

app = app.replace(handleDeleteBiomarkerLogTarget, handleDeleteBiomarkerCode);

const propsTarget = `onDeleteBiomarkerLog={handleDeleteBiomarkerLog}`;
const propsCode = `onDeleteBiomarker={handleDeleteBiomarker}\n            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}`;
app = app.replace(propsTarget, propsCode);

fs.writeFileSync('src/App.tsx', app);
