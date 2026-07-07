const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const routeOld1 = `{(() => {
                                const sourceDef = profile.customBiomarkers?.[src] || biomarkerDefinitions.find(d => d.key === src);
                                return (
                                  <div className="flex flex-col items-start max-w-[45%] text-left">
                                    <span className="text-rose-500 dark:text-rose-400 truncate w-full" title={src}>{sourceDef?.name || src}</span>
                                    {sourceDef?.unit && <span className="text-[9px] text-slate-400">{sourceDef.unit}</span>}
                                  </div>
                                );
                              })()}`;

const routeNew1 = `{(() => {
                                const sourceDef = profile.customBiomarkers?.[src] || biomarkerDefinitions.find(d => d.key === src);
                                const latestVal = biomarkers[src] !== undefined ? biomarkers[src] : 'N/A';
                                return (
                                  <div className="flex flex-col items-start max-w-[45%] text-left">
                                    <span className="text-rose-500 dark:text-rose-400 truncate w-full" title={src}>{sourceDef?.name || src}</span>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      {latestVal !== 'N/A' && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">Val: {latestVal}</span>}
                                      {sourceDef?.unit && <span className="text-[9px] text-slate-400 font-mono">{sourceDef.unit}</span>}
                                    </div>
                                    <span className="text-[8px] text-slate-400 truncate w-full opacity-70 mt-0.5" title={src}>{src}</span>
                                  </div>
                                );
                              })()}`;

code = code.replace(routeOld1, routeNew1);

const routeOld2 = `{(() => {
                                const targetDef = profile.customBiomarkers?.[tgt] || biomarkerDefinitions.find(d => d.key === tgt);
                                return (
                                  <div className="flex flex-col items-end max-w-[45%] text-right">
                                    <span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgt}>{src === tgt ? 'Approve as New Standard' : (targetDef?.name || tgt)}</span>
                                    {src !== tgt && targetDef?.unit && <span className="text-[9px] text-slate-400">{targetDef.unit}</span>}
                                  </div>
                                );
                              })()}`;

const routeNew2 = `{(() => {
                                const targetDef = profile.customBiomarkers?.[tgt] || biomarkerDefinitions.find(d => d.key === tgt);
                                const latestVal = biomarkers[tgt] !== undefined ? biomarkers[tgt] : 'N/A';
                                return (
                                  <div className="flex flex-col items-end max-w-[45%] text-right">
                                    <span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgt}>{src === tgt ? 'Approve as New Standard' : (targetDef?.name || tgt)}</span>
                                    {src !== tgt && (
                                      <div className="flex items-center gap-1 mt-0.5 justify-end">
                                        {latestVal !== 'N/A' && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">Val: {latestVal}</span>}
                                        {targetDef?.unit && <span className="text-[9px] text-slate-400 font-mono">{targetDef.unit}</span>}
                                      </div>
                                    )}
                                    <span className="text-[8px] text-slate-400 truncate w-full opacity-70 mt-0.5 text-right" title={tgt}>{tgt}</span>
                                  </div>
                                );
                              })()}`;

code = code.replace(routeOld2, routeNew2);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal route agent table");
