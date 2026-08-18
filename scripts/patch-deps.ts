import fs from 'fs';

let path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "}, [allApprovedKeysUnfiltered, searchQuery, profile.customBiomarkers, filterOption, filterTag]);",
  "}, [allApprovedKeysUnfiltered, searchQuery, profile.customBiomarkers, filterOption, filterTag, aliasKeysToHide]);"
);

code = code.replace(
  "}, [historyKeys, customKeys, searchQuery, profile.customBiomarkers, filterOption, biomarkerHistory, filterTag]);",
  "}, [historyKeys, customKeys, searchQuery, profile.customBiomarkers, filterOption, biomarkerHistory, filterTag, aliasKeysToHide]);"
);

code = code.replace(
  "}, [toApproveKeys, allApprovedKeys]);",
  "}, [toApproveKeys, allApprovedKeys, aliasKeysToHide]);"
);

code = code.replace(
  "}, [historyKeys, customKeys, profile.customBiomarkers, isKeyNotUsed]);",
  "}, [historyKeys, customKeys, profile.customBiomarkers, isKeyNotUsed, aliasKeysToHide]);"
);

fs.writeFileSync(path, code);

path = 'src/components/MedicalHistoryTab.tsx';
code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "}, [biomarkers, activeHistory, profile.customBiomarkers, profile.ethnicity, profile.gender, profile.height, isKeyNotUsedInMedicalHistory]);",
  "}, [biomarkers, activeHistory, profile.customBiomarkers, profile.ethnicity, profile.gender, profile.height, isKeyNotUsedInMedicalHistory, aliasKeysToHide]);"
);

fs.writeFileSync(path, code);
