const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldDisplay = `                {!initialUnit ? (
                  <div className="mt-2 text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/20 border border-rose-100/50 dark:border-rose-900/35 px-2.5 py-1 rounded-lg w-fit flex items-center gap-1.5 font-extrabold ring-1 ring-rose-500/10">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    Missing Unit - Update Required
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Unit:</span> {initialUnit} 
                    {initialNormalRange && <span className="ml-2"><span className="font-semibold text-slate-700 dark:text-slate-300">Range:</span> {initialNormalRange}</span>}
                  </div>
                )}`;

const newDisplay = `                {!initialUnit ? (
                  <div className="mt-2 text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/20 border border-rose-100/50 dark:border-rose-900/35 px-2.5 py-1 rounded-lg w-fit flex items-center gap-1.5 font-extrabold ring-1 ring-rose-500/10">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    Missing Unit - Update Required
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Unit:</span> {initialUnit} 
                    {initialNormalRange && <span className="ml-2"><span className="font-semibold text-slate-700 dark:text-slate-300">Range:</span> {initialNormalRange}</span>}
                    {(customDef?.rangeConfig || customDef?.customRanges?.length > 0) && (
                      <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                        Structured Ranges Active
                      </span>
                    )}
                  </div>
                )}`;

code = code.replace(oldDisplay, newDisplay);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal display");
