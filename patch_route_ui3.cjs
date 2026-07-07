const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const targetStr = '<span className="text-rose-500 dark:text-rose-400 truncate max-w-[45%]" title={src}>{src}</span>';

const replacement = `{(() => {
                                const sourceDef = profile.customBiomarkers?.[src] || biomarkerDefinitions.find(d => d.key === src);
                                return (
                                  <div className="flex flex-col items-start max-w-[45%] text-left">
                                    <span className="text-rose-500 dark:text-rose-400 truncate w-full" title={src}>{sourceDef?.name || src}</span>
                                    {sourceDef?.unit && <span className="text-[9px] text-slate-400">{sourceDef.unit}</span>}
                                  </div>
                                );
                              })()}`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched suggestedMapping UI 3");
