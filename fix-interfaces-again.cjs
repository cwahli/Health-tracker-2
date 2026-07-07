const fs = require('fs');

let dictCode = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');
dictCode = dictCode.replace(
  "onUpdateProfile: (updates: Partial<UserProfile>) => void;",
  "onUpdateProfile: (updates: Partial<UserProfile>) => void;\n  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;"
);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', dictCode);

let histCode = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');
histCode = histCode.replace(
  "onDeleteBiomarkerLog: (id: string) => void;",
  "onDeleteBiomarkerLog: (id: string) => void;\n  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;"
);
fs.writeFileSync('src/components/MedicalHistoryTab.tsx', histCode);
console.log('Fixed interfaces again');
