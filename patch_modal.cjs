const fs = require('fs');
let content = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const search = `                  </button>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setShowCleaningDropdown(!showCleaningDropdown)}
                      className="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-md shadow-indigo-600/10 cursor-pointer whitespace-nowrap"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      Cleaning Agent
                      <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
                    </button>

                    {showCleaningDropdown && (
                      <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-theme-border py-1.5 min-w-[220px] z-[100] animate-in fade-in slide-in-from-top-2">
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsRangeCalibrationMode(true);
                            setIsMedicalCategorisationMode(false);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/25"
                        >
                          ⚖️ Calibrate Ranges
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsMedicalCategorisationMode(false);
                            setIsRangeCalibrationMode(false);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          Unit Relabel
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsMedicalCategorisationMode(true);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          Categoriser
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsDataAccuracyMode(true);
                            setIsChatMode(false);
                            setIsAgentMode(false);
                            setIsMedicalCategorisationMode(false);
                            setIsNameConsolidationMode(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/25"
                        >
                          ✨ Field Compare
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsNameConsolidationMode(true);
                            setIsAgentMode(false);
                            setIsMedicalCategorisationMode(false);
                            setIsDataAccuracyMode(false);
                            setIsChatMode(false);
                            setConsolidationYaml(null);
                            setConsolidationGroups(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-violet-600 dark:text-violet-400 font-semibold hover:bg-violet-50 dark:hover:bg-violet-950/25 border-t border-slate-100 dark:border-slate-700/50 mt-1 pt-2"
                        >
                          🤝 Name Deduper
                        </button>
                      </div>
                    )}
                  </div>
                  {showDeleteSelectedConfirm ? (`;
const replace = `                  </button>
                  {showDeleteSelectedConfirm ? (`;

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', content.replace(search, replace));
