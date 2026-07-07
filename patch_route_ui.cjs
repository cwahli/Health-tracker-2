const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldMap = `{Object.entries(msg.suggestedMapping).map(([src, tgt]) => (
                            <div key={src} className="flex items-center justify-between text-xs font-mono py-1 border-b border-indigo-50/50 dark:border-slate-700/50">
                              <span className="text-rose-500 dark:text-rose-400 truncate max-w-[45%]" title={src}>{src}</span>
                              <span className="text-slate-400">→</span>
                              <span className="text-emerald-500 dark:text-emerald-400 truncate max-w-[45%]" title={tgt}>{tgt}</span>
                            </div>
                          ))}`;

const newMap = `{Object.entries(msg.suggestedMapping).map(([src, tgt]) => (
                            <div key={src} className="flex items-center justify-between text-xs font-mono py-1 border-b border-indigo-50/50 dark:border-slate-700/50">
                              <span className="text-rose-500 dark:text-rose-400 truncate max-w-[45%]" title={src}>{src}</span>
                              <span className="text-slate-400">→</span>
                              <span className="text-emerald-500 dark:text-emerald-400 truncate max-w-[45%]" title={tgt}>{src === tgt ? 'Approve as New Standard' : tgt}</span>
                            </div>
                          ))}`;

code = code.replace(oldMap, newMap);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched suggestedMapping UI");
