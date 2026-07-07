const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const targetStr = '<span className="text-emerald-500 dark:text-emerald-400 truncate max-w-[45%]" title={tgt}>{src === tgt ? \'Approve as New Standard\' : tgt}</span>';

const replacement = `{(() => {
                                const targetDef = profile.customBiomarkers?.[tgt] || biomarkerDefinitions.find(d => d.key === tgt);
                                return (
                                  <div className="flex flex-col items-end max-w-[45%] text-right">
                                    <span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgt}>{src === tgt ? 'Approve as New Standard' : (targetDef?.name || tgt)}</span>
                                    {src !== tgt && targetDef?.unit && <span className="text-[9px] text-slate-400">{targetDef.unit}</span>}
                                  </div>
                                );
                              })()}`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched suggestedMapping UI 2");
