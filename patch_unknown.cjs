const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldLine1 = `const targetDef = profile.customBiomarkers?.[tgt] || biomarkerDefinitions.find(d => d.key === tgt);`;
const newLine1 = `const tgtKey = String(tgt); const targetDef = profile.customBiomarkers?.[tgtKey] || biomarkerDefinitions.find(d => d.key === tgtKey);`;
code = code.replace(oldLine1, newLine1);

const oldLine2 = `const latestVal = biomarkers[tgt] !== undefined ? biomarkers[tgt] : 'N/A';`;
const newLine2 = `const latestVal = biomarkers[tgtKey] !== undefined ? biomarkers[tgtKey] : 'N/A';`;
code = code.replace(oldLine2, newLine2);

const oldLine3 = `<span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgt}>{src === tgt ? 'Approve as New Standard' : (targetDef?.name || tgt)}</span>`;
const newLine3 = `<span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgtKey}>{src === tgtKey ? 'Approve as New Standard' : (targetDef?.name || tgtKey)}</span>`;
code = code.replace(oldLine3, newLine3);

const oldLine4 = `<span className="font-mono text-slate-400">{latestVal} {targetDef?.unit || ''}</span>`;
code = code.replace(oldLine4, oldLine4); // This line is fine if latestVal is updated

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched unknown type");
