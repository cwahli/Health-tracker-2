const fs = require('fs');
let content = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const target1 = `{initialGrouping && (
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {initialGrouping}
                    </span>
                  )}`;

const repl1 = `{initialGrouping && (
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <span className="text-[8px] uppercase tracking-wider opacity-70">Medical Practice:</span>
                      {initialGrouping}
                    </span>
                  )}`;

content = content.replace(target1, repl1);

const target2 = `{(initialRisk || initialConditions) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {initialRisk && initialRisk.split(',').map((r: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(r.trim())}
                        className={\`text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 rounded-full border border-rose-100 dark:border-rose-900/30 \${onTagClick ? 'cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-900/40' : ''}\`}
                      >
                        {r.trim()}
                      </span>
                    ))}
                    {initialConditions && initialConditions.split(',').map((c: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(c.trim())}
                        className={\`text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-full border border-amber-100 dark:border-amber-900/30 \${onTagClick ? 'cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40' : ''}\`}
                      >
                        {c.trim()}
                      </span>
                    ))}
                  </div>
                )}`;

const repl2 = `{(initialRisk || initialConditions) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {initialRisk && initialRisk.split(',').map((r: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(r.trim())}
                        className={\`text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 rounded-full border border-rose-100 dark:border-rose-900/30 flex items-center gap-1 \${onTagClick ? 'cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-900/40' : ''}\`}
                      >
                        <span className="text-[7.5px] uppercase tracking-wider opacity-60">Risk:</span>
                        {r.trim()}
                      </span>
                    ))}
                    {initialConditions && initialConditions.split(',').map((c: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(c.trim())}
                        className={\`text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-full border border-amber-100 dark:border-amber-900/30 flex items-center gap-1 \${onTagClick ? 'cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40' : ''}\`}
                      >
                        <span className="text-[7.5px] uppercase tracking-wider opacity-60">Condition:</span>
                        {c.trim()}
                      </span>
                    ))}
                  </div>
                )}`;

content = content.replace(target2, repl2);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', content);
