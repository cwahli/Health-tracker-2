const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

// Replace standardizing loading messages to show a start button in name consolidation mode
const chatRegex = /                        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50\/50 dark:bg-slate-900\/20">/g;
code = code.replace(chatRegex, `                        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/20">
                          {consolidationMessages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-80">
                              <BrainCircuit className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-2" />
                              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">Name Consolidation Agent</h3>
                              <p className="text-sm text-slate-500 max-w-sm">
                                This agent will analyze your selected biomarkers and automatically suggest consolidations for any duplicates or variations.
                              </p>
                              <button
                                onClick={() => handleSendConsolidation(null)}
                                disabled={consolidationLoading || Object.keys(checkedItems).length < 2}
                                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-all shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <BrainCircuit className="w-4 h-4" />
                                Start Auto-Consolidation
                              </button>
                              {Object.keys(checkedItems).length < 2 && (
                                <p className="text-xs text-amber-600 mt-2">Please select at least 2 biomarkers from the main list first.</p>
                              )}
                            </div>
                          )}`);

// Add missing columns to Consolidation Groups Table
const tableHeadRegex = /                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800 rounded-tl-lg">Target Key<\/th>\n                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800">Target Name<\/th>\n                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800 rounded-tr-lg">Included Biomarkers<\/th>/g;
code = code.replace(tableHeadRegex, `                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800 rounded-tl-lg">Target Key & Name</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800">Included Biomarkers Details</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-slate-800 rounded-tr-lg">Action</th>`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
