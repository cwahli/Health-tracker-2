const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /                    <div className="mt-4 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 text-left">\n                      <div className="font-bold text-slate-700 dark:text-slate-300 mb-2">Selected Biomarkers \(\{selectedKeys\.length\}\):<\/div>\n                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">\n                        \{selectedKeys\.length === 0 \? \(\n                          <span className="italic text-slate-400">No biomarkers selected\. Select them from the list\.<\/span>\n                        \) : \(\n                          selectedKeys\.map\(k => \{\n                            const name = biomarkerDefinitions\.find\(d => d\.key === k\)\?\.name \|\| profile\.customBiomarkers\?\.\[k\]\?\.name \|\| k;\n                            return \(\n                              <span key=\{k\} className="px-2 py-0\.5 bg-slate-100 dark:bg-slate-800 rounded-full text-\[10px\] font-mono border border-slate-200 dark:border-slate-700">\{name\}<\/span>\n                            \);\n                          \}\)\n                        \)\}\n                      <\/div>\n                    <\/div>\n                  <\/div>/g;

const newText = `                    <div className="mt-4 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 text-left">
                      <div className="font-bold text-slate-700 dark:text-slate-300 mb-2">Selected Biomarkers ({selectedKeys.length}):</div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {selectedKeys.length === 0 ? (
                          <span className="italic text-slate-400">No biomarkers selected. Select them from the list.</span>
                        ) : (
                          selectedKeys.map(k => {
                            const name = biomarkerDefinitions.find(d => d.key === k)?.name || profile.customBiomarkers?.[k]?.name || k;
                            return (
                              <span key={k} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-mono border border-slate-200 dark:border-slate-700">{name}</span>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRunConsolidationAgent(true)}
                      disabled={consolidationLoading || selectedKeys.length < 2}
                      className="mt-6 mx-auto px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <BrainCircuit className="w-4 h-4" />
                      Start Auto-Consolidation
                    </button>
                    {selectedKeys.length < 2 && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">Select at least 2 biomarkers to consolidate.</p>
                    )}
                  </div>`;

code = code.replace(regex, newText);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
