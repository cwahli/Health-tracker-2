const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /<div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700">[\s\S]*?(?=<div>\s*<label className="block text-\[10px\] font-bold text-slate-500 mb-1 uppercase">Medical Grouping<\/label>)/;

const newUI = `<div className="mt-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Range Configuration</label>
                  <BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    onChange={(r, c) => setEditState({ ...editState, rangeConfig: r, customRanges: c })}
                  />
                </div>
                `;

code = code.replace(regex, newUI);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal UI");
