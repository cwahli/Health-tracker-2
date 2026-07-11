const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const initEditsTarget = `      parsed.forEach((group: any, idx: number) => {
        const firstKey = group.biomarkers?.[0]?.key || group.recommendedUniqueKey || '';
        initialEdits[idx] = {
          recommendedClinicalName: group.recommendedClinicalName || group.groupName || '',
          recommendedUniqueKey: group.recommendedUniqueKey || '',
          masterKey: firstKey,
          excludedKeys: {}
        };
      });`;

const initEditsReplacement = `      parsed.forEach((group: any, idx: number) => {
        const firstKey = group.biomarkers?.[0]?.key || group.recommendedUniqueKey || '';
        const masterBio = group.biomarkers?.[0] || {};
        const origMasterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {};
        initialEdits[idx] = {
          recommendedClinicalName: group.recommendedClinicalName || group.groupName || '',
          recommendedUniqueKey: group.recommendedUniqueKey || '',
          masterKey: firstKey,
          excludedKeys: {},
          unit: masterBio.unit || origMasterDef.unit || '',
          normalRange: masterBio.range || origMasterDef.normalRange || '',
          description: masterBio.description || origMasterDef.description || ''
        };
      });`;

const handleTarget = `        const targetDef = {
          name: targetName,
          unit: masterBio?.unit || '',
          normalRange: masterBio?.range || origMasterDef.normalRange || '',
          description: masterBio?.description || origMasterDef.description || ''
        };`;

const handleReplacement = `        const targetDef = {
          name: targetName,
          unit: edits.unit !== undefined ? edits.unit : (masterBio?.unit || ''),
          normalRange: edits.normalRange !== undefined ? edits.normalRange : (masterBio?.range || origMasterDef.normalRange || ''),
          description: edits.description !== undefined ? edits.description : (masterBio?.description || origMasterDef.description || '')
        };`;

if (code.includes(initEditsTarget)) {
  code = code.replace(initEditsTarget, initEditsReplacement);
  code = code.replace(handleTarget, handleReplacement);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log("Fixed edits structure");
} else {
  console.log("Could not find edits target");
}
