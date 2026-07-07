const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldSave = `  const handleSave = () => {
    onSave({
      newKey: editState.key !== itemKey ? editState.key : undefined,
      name: editState.name.trim(),
      unit: editState.unit.trim(),
      normalRange: editState.normalRange.trim(),
      structuredRanges: editState.structuredRanges,
      standardMedicalGrouping: editState.standardMedicalGrouping,`;

const newSave = `  const handleSave = () => {
    onSave({
      newKey: editState.key !== itemKey ? editState.key : undefined,
      name: editState.name.trim(),
      unit: editState.unit.trim(),
      normalRange: editState.normalRange.trim(),
      rangeConfig: editState.rangeConfig,
      customRanges: editState.customRanges,
      standardMedicalGrouping: editState.standardMedicalGrouping,`;

code = code.replace(oldSave, newSave);

const oldCancel = `  const handleCancel = () => {
    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      structuredRanges: customDef?.structuredRanges || [],
      standardMedicalGrouping: initialGrouping,`;

const newCancel = `  const handleCancel = () => {
    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      rangeConfig: customDef?.rangeConfig,
      customRanges: customDef?.customRanges || [],
      standardMedicalGrouping: initialGrouping,`;

code = code.replace(oldCancel, newCancel);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal handleSave");
