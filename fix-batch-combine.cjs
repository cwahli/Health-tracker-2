const fs = require('fs');

let appCode = fs.readFileSync('src/App.tsx', 'utf8');

const batchFunction = `
  const handleBatchCombineBiomarkers = async (
    combinations: {
      targetKey: string;
      targetDef: any;
      mergedLogs: { date: string; value: number | string; originalLogId?: string }[];
      sourceKeysToDelete: string[];
    }[]
  ) => {
    let updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    let updatedHistory = [...biomarkerHistory];
    
    combinations.forEach(combo => {
      const { targetKey, targetDef, mergedLogs, sourceKeysToDelete } = combo;
      
      sourceKeysToDelete.forEach(k => {
        delete updatedCustomBiomarkers[k];
      });
      const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
      const existingCustom = updatedCustomBiomarkers[targetKey];
      
      updatedCustomBiomarkers[targetKey] = {
        ...(builtIn || {}),
        ...(existingCustom || {}),
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
        riskCategories: targetDef.riskCategories || [],
        potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
        ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
        ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
      };

      updatedHistory = updatedHistory.map(log => {
        const cleanBiomarkers = { ...log.biomarkers };
        sourceKeysToDelete.forEach(k => {
          delete cleanBiomarkers[k];
        });
        return {
          ...log,
          biomarkers: cleanBiomarkers
        };
      });

      mergedLogs.forEach(ml => {
        let existingIndex = -1;
        if (ml.originalLogId) {
          existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
        }
        if (existingIndex < 0) {
          existingIndex = updatedHistory.findIndex(h => h.date === ml.date);
        }
        if (existingIndex >= 0) {
          updatedHistory[existingIndex] = {
            ...updatedHistory[existingIndex],
            biomarkers: {
              ...updatedHistory[existingIndex].biomarkers,
              [targetKey]: ml.value
            }
          };
        } else {
          updatedHistory.push({
            id: \`med_log_combined_\${Date.now()}_\${Math.random().toString(36).substr(2, 5)}\`,
            date: ml.date,
            biomarkers: {
              [targetKey]: ml.value
            }
          });
        }
      });
    });

    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => b.date.localeCompare(a.date));

    const updatedProfile: UserProfile = {
      ...profile as any,
      customBiomarkers: updatedCustomBiomarkers
    };

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
  };
`;

appCode = appCode.replace("const handleCombineBiomarkers = async (", batchFunction + "\n\n  const handleCombineBiomarkers = async (");
appCode = appCode.replace("onCombineBiomarkers={handleCombineBiomarkers}", "onCombineBiomarkers={handleCombineBiomarkers}\n            onBatchCombineBiomarkers={handleBatchCombineBiomarkers}");

fs.writeFileSync('src/App.tsx', appCode);

let modalCode = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

modalCode = modalCode.replace(
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;",
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;\n  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;"
);

modalCode = modalCode.replace(
  "onCombineBiomarkers,\n  onBatchConsolidate,",
  "onCombineBiomarkers,\n  onBatchCombineBiomarkers,\n  onBatchConsolidate,"
);

const oldApplyLogic = `      for (let idx = 0; idx < consolidationGroups.length; idx++) {
        const group = consolidationGroups[idx];
        const edits = groupEdits[idx];
        if (!edits) continue;

        const targetKey = edits.recommendedUniqueKey;
        const targetName = edits.recommendedClinicalName;

        const includedBiomarkers = group.biomarkers.filter((b: any) => !edits.excludedKeys[b.key]);
        if (includedBiomarkers.length === 0) continue;

        const masterBio = includedBiomarkers.find((b: any) => b.key === edits.masterKey) || includedBiomarkers[0];
        
        const origMasterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {};
        const targetDef = {
          name: targetName,
          unit: masterBio?.unit || '',
          normalRange: masterBio?.range || '',
          description: masterBio?.description || '',
          standardMedicalGrouping: (origMasterDef as any).standardMedicalGrouping || (origMasterDef as any).medicalGrouping || masterBio?.medicalGrouping || '',
          riskCategories: (origMasterDef as any).riskCategories || [],
          potentialMedicalConditions: (origMasterDef as any).potentialMedicalConditions || [],
          rangeConfig: (origMasterDef as any).rangeConfig,
          customRanges: (origMasterDef as any).customRanges
        };

        const sourceKeysToDelete = includedBiomarkers.map((b: any) => b.key).filter((k: string) => k !== targetKey);

        const mergedLogsMap: { [date: string]: { value: string | number, originalLogId?: string } } = {};

        biomarkerHistory.forEach((log) => {
          let valueFound: string | number | null = null;
          let originalLogId = log.id;

          if (log.biomarkers[edits.masterKey] !== undefined) {
            valueFound = log.biomarkers[edits.masterKey];
          } else {
            for (const b of includedBiomarkers) {
              if (log.biomarkers[b.key] !== undefined) {
                valueFound = log.biomarkers[b.key];
                break;
              }
            }
          }

          if (valueFound !== null && valueFound !== undefined && valueFound !== '') {
            if (mergedLogsMap[log.date]) {
              // Same date already logged, duplicate removed.
            } else {
              mergedLogsMap[log.date] = {
                value: valueFound,
                originalLogId
              };
            }
          }
        });

        const mergedLogs = Object.entries(mergedLogsMap).map(([date, data]) => ({
          date,
          value: data.value,
          originalLogId: data.originalLogId
        }));

        await onCombineBiomarkers(targetKey, targetDef, mergedLogs, sourceKeysToDelete);
      }`;

const newApplyLogic = `      const combinationsToApply: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[] = [];
      
      for (let idx = 0; idx < consolidationGroups.length; idx++) {
        const group = consolidationGroups[idx];
        const edits = groupEdits[idx];
        if (!edits) continue;

        const targetKey = edits.recommendedUniqueKey;
        const targetName = edits.recommendedClinicalName;

        const includedBiomarkers = group.biomarkers.filter((b: any) => !edits.excludedKeys[b.key]);
        if (includedBiomarkers.length === 0) continue;

        const masterBio = includedBiomarkers.find((b: any) => b.key === edits.masterKey) || includedBiomarkers[0];
        
        const origMasterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {};
        const targetDef = {
          name: targetName,
          unit: masterBio?.unit || '',
          normalRange: masterBio?.range || '',
          description: masterBio?.description || '',
          standardMedicalGrouping: (origMasterDef as any).standardMedicalGrouping || (origMasterDef as any).medicalGrouping || masterBio?.medicalGrouping || '',
          riskCategories: (origMasterDef as any).riskCategories || [],
          potentialMedicalConditions: (origMasterDef as any).potentialMedicalConditions || [],
          rangeConfig: (origMasterDef as any).rangeConfig,
          customRanges: (origMasterDef as any).customRanges
        };

        const sourceKeysToDelete = includedBiomarkers.map((b: any) => b.key).filter((k: string) => k !== targetKey);

        const mergedLogsMap: { [date: string]: { value: string | number, originalLogId?: string } } = {};

        biomarkerHistory.forEach((log) => {
          let valueFound: string | number | null = null;
          let originalLogId = log.id;

          if (log.biomarkers[edits.masterKey] !== undefined) {
            valueFound = log.biomarkers[edits.masterKey];
          } else {
            for (const b of includedBiomarkers) {
              if (log.biomarkers[b.key] !== undefined) {
                valueFound = log.biomarkers[b.key];
                break;
              }
            }
          }

          if (valueFound !== null && valueFound !== undefined && valueFound !== '') {
            if (mergedLogsMap[log.date]) {
              // Same date already logged, duplicate removed.
            } else {
              mergedLogsMap[log.date] = {
                value: valueFound,
                originalLogId
              };
            }
          }
        });

        const mergedLogs = Object.entries(mergedLogsMap).map(([date, data]) => ({
          date,
          value: data.value,
          originalLogId: data.originalLogId
        }));

        combinationsToApply.push({ targetKey, targetDef, mergedLogs, sourceKeysToDelete });
      }

      if (onBatchCombineBiomarkers && combinationsToApply.length > 0) {
        await onBatchCombineBiomarkers(combinationsToApply);
      } else if (combinationsToApply.length > 0) {
        for (const combo of combinationsToApply) {
          await onCombineBiomarkers(combo.targetKey, combo.targetDef, combo.mergedLogs, combo.sourceKeysToDelete);
        }
      }`;

if (modalCode.includes(oldApplyLogic)) {
  modalCode = modalCode.replace(oldApplyLogic, newApplyLogic);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', modalCode);
  console.log('Fixed batch combining logic');
} else {
  console.log('Could not find old apply logic string in BiomarkerDictionaryModal.tsx');
}

