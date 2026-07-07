const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const oldFunc = `  const handleStandardizeBiomarkerUnits = async (updates: { [key: string]: { unit: string; name: string } }) => {
    let hasChanges = false;
    const updatedProfile = { ...profile };
    if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};

    for (const [key, val] of Object.entries(updates)) {
      const oldCustom = updatedProfile.customBiomarkers[key] || {};
      updatedProfile.customBiomarkers[key] = {
        ...oldCustom,
        name: val.name || oldCustom.name,
        unit: val.unit,
        standardMedicalGrouping: oldCustom.standardMedicalGrouping || "By Medical Practice"
      };
      hasChanges = true;
    }`;

const newFunc = `  const handleStandardizeBiomarkerUnits = async (updates: { [key: string]: any }) => {
    let hasChanges = false;
    const updatedProfile = { ...profile };
    if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};

    for (const [key, val] of Object.entries(updates)) {
      const oldCustom = updatedProfile.customBiomarkers[key] || {};
      updatedProfile.customBiomarkers[key] = {
        ...oldCustom,
        name: val.name || oldCustom.name,
        unit: val.unit !== undefined ? val.unit : oldCustom.unit,
        standardMedicalGrouping: val.standardMedicalGrouping !== undefined ? val.standardMedicalGrouping : (oldCustom.standardMedicalGrouping || "By Medical Practice"),
        riskCategories: val.riskCategories !== undefined ? val.riskCategories : oldCustom.riskCategories,
        potentialMedicalConditions: val.potentialMedicalConditions !== undefined ? val.potentialMedicalConditions : oldCustom.potentialMedicalConditions
      };
      hasChanges = true;
    }`;

code = code.replace(oldFunc, newFunc);
fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx handleStandardizeBiomarkerUnits");
