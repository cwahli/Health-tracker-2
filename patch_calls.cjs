const fs = require('fs');

const patchFile = (filename, replacements) => {
  let code = fs.readFileSync(filename, 'utf8');
  for (const [search, replace] of replacements) {
    code = code.split(search).join(replace);
  }
  fs.writeFileSync(filename, code);
};

patchFile('src/components/HomeTab.tsx', [
  ['getBiomarkerStatus(key, val as string | number, def.normalRange)', 'getBiomarkerStatus(key, val as string | number, def.normalRange, def, profile)'],
  ['getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value)', 'getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value, profile)'],
  ['getBiomarkerStatusLabel(expandedInChunk.key, expandedInChunk.status, profile.customBiomarkers?.[expandedInChunk.key], expandedInChunk.value)', 'getBiomarkerStatusLabel(expandedInChunk.key, expandedInChunk.status, profile.customBiomarkers?.[expandedInChunk.key], expandedInChunk.value, profile)']
]);

patchFile('src/components/MedicalHistoryTab.tsx', [
  ['getBiomarkerStatus(key, val, def?.normalRange)', 'getBiomarkerStatus(key, val, def?.normalRange, def, profile)'],
  ['getBiomarkerStatus(def.key, val, def.normalRange)', 'getBiomarkerStatus(def.key, val, def.normalRange, def, profile)'],
  ['getBiomarkerStatusLabel(def.key, status, profile.customBiomarkers?.[def.key], val)', 'getBiomarkerStatusLabel(def.key, status, profile.customBiomarkers?.[def.key], val, profile)'],
  ['getBiomarkerRiskTag(def.key, status, profile.customBiomarkers?.[def.key], val)', 'getBiomarkerRiskTag(def.key, status, profile.customBiomarkers?.[def.key], val, profile)']
]);

patchFile('src/components/LogChat.tsx', [
  ['getBiomarkerStatus(key, val, normalRange)', 'getBiomarkerStatus(key, val, normalRange, def, profile)'],
  ['getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value)', 'getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile)']
]);

patchFile('src/components/ReviewBiomarkerModal.tsx', [
  ["getBiomarkerStatus(biomarkerKey, currentValue, def?.normalRange || '')", "getBiomarkerStatus(biomarkerKey, currentValue, def?.normalRange || '', def, profile)"]
]);

console.log("Patched function calls");
