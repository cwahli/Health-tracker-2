const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const selectBlock = `                <select
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value as any)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="all">All Approved ({allApprovedKeysUnfiltered.length})</option>
                  <option value="overrides">Custom Overrides ({allApprovedKeysUnfiltered.filter(hasActualOverride).length})</option>
                  <option value="missing_units">Missing Units ({missingUnitsCount})</option>
                </select>
                {filterTag && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold border border-indigo-100 dark:border-indigo-800">
                    Tag: {filterTag}
                    <button onClick={() => setFilterTag(null)} className="ml-1 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}`;

const selectRepl = `                <select
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value as any)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="all">All Approved ({allApprovedKeysUnfiltered.length})</option>
                  <option value="overrides">Custom Overrides ({allApprovedKeysUnfiltered.filter(hasActualOverride).length})</option>
                  <option value="missing_units">Missing Units ({missingUnitsCount})</option>
                </select>
                <select
                  value={filterTag || ""}
                  onChange={(e) => setFilterTag(e.target.value || null)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="">All Tags</option>
                  <optgroup label="Medical Practice">
                    {Array.from(allGroupings).sort().map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Risk Categories">
                    {Array.from(allRisks).sort().map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Conditions">
                    {Array.from(allConditions).sort().map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                </select>`;

code = code.replace(selectBlock, selectRepl);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
