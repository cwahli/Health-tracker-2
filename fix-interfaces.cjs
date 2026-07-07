const fs = require('fs');

let appCode = fs.readFileSync('src/App.tsx', 'utf8');
appCode = appCode.replace(
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;",
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;\n  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;"
);
fs.writeFileSync('src/App.tsx', appCode);

let dictCode = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');
dictCode = dictCode.replace(
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;",
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;\n  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;"
);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', dictCode);

let histCode = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');
histCode = histCode.replace(
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;",
  "onCombineBiomarkers: (targetKey: string, targetDef: any, mergedLogs: { date: string; value: number | string }[], sourceKeysToDelete: string[]) => Promise<void>;\n  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;"
);
if (histCode.includes("onCombineBiomarkers,")) {
  histCode = histCode.replace(
    "onCombineBiomarkers,",
    "onCombineBiomarkers,\n  onBatchCombineBiomarkers,"
  );
}
if (histCode.includes("onCombineBiomarkers={onCombineBiomarkers}")) {
  histCode = histCode.replace(
    "onCombineBiomarkers={onCombineBiomarkers}",
    "onCombineBiomarkers={onCombineBiomarkers}\n            onBatchCombineBiomarkers={onBatchCombineBiomarkers}"
  );
}

fs.writeFileSync('src/components/MedicalHistoryTab.tsx', histCode);
console.log('Fixed interfaces');
