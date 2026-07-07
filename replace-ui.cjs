const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regexUI = /        \) : isNameConsolidationMode \? \([\s\S]*?        \) : isChatMode \? \(/;

const replacement = `        ) : isNameConsolidationMode ? (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-50 dark:bg-slate-950">
            {/* Left side: Chat thread */}
            <div className={\`flex-1 flex flex-col overflow-hidden \${consolidationGroups ? 'md:w-5/12 md:border-r md:border-slate-200 dark:md:border-slate-800' : 'w-full'}\`}>
              {/* Settings Panel */}
              <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
                <div className="w-full sm:w-56">
                  <LLMSelector
                    selectedModelId={nameConsolidationModel}
                    onChangeModelId={setNameConsolidationModel}
                    label="Consolidation Engine"
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 self-center">
                  <button
                    type="button"
                    onClick={() => setShowConsolidationInstructions(true)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                  </button>
                  {consolidationMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setConsolidationMessages([])}
                      className="text-xs text-rose-500 font-bold hover:underline cursor-pointer flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-3 ml-2"
                    >
                      Clear Chat
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-50 dark:bg-slate-900/50">
                {consolidationMessages.length === 0 ? (
                  <div className="m-auto max-w-sm text-center">
                    <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                      <BrainCircuit className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2 font-sans tracking-tight">Name Consolidation Agent</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Select biomarkers you want to consolidate. I will analyze their names, standard medical groupings, units, and ranges to find duplicates and automatically group them.
                    </p>
                    <div className="mt-4 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 text-left">
                      <div className="font-bold text-slate-700 dark:text-slate-300 mb-2">Selected Biomarkers ({selectedKeys.length}):</div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {selectedKeys.length === 0 ? (
                          <span className="italic text-slate-400">No biomarkers selected. Select them from the list.</span>
                        ) : (
                          selectedKeys.map(k => {
                            const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
                            return (
                              <span key={k} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md">
                                {def?.name || k}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {consolidationMessages.map((msg, idx) => (
                      <div key={idx} className={\`flex gap-3 \${msg.role === 'user' ? 'justify-end' : 'justify-start'}\`}>
                        {msg.role === 'agent' && (
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                            <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          </div>
                        )}
                        <div className={\`max-w-[85%] rounded-2xl p-4 \${
                          msg.role === 'user' 
                            ? 'bg-indigo-600 text-white shadow-md' 
                            : msg.isError
                              ? 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400'
                              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 shadow-sm'
                        }\`}>
                          <div className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans">{msg.content}</div>
                          {msg.timestamp && (
                            <div className={\`text-[10px] mt-2 \${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'}\`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {consolidationLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                          <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
                        </div>
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-2">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                          </div>
                          <span className="text-[13px] text-slate-500 font-medium ml-2">Analyzing biomarkers...</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <div className="relative flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunConsolidationAgent(true)}
                    disabled={consolidationLoading || selectedKeys.length === 0}
                    className="p-3 rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50"
                    title="Run Auto-Consolidation without text"
                  >
                    <BrainCircuit className="w-5 h-5" />
                  </button>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-4 pr-12 py-3 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
                      placeholder="Ask the agent to group specific items or just click the magic button..."
                      value={consolidationInput}
                      onChange={e => setConsolidationInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRunConsolidationAgent()}
                      disabled={consolidationLoading}
                    />
                    <button
                      type="button"
                      onClick={() => handleRunConsolidationAgent()}
                      disabled={consolidationLoading || (!consolidationInput.trim() && selectedKeys.length === 0)}
                      className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right side: Consolidation Data */}
            {consolidationGroups && (
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950/20 md:border-l md:border-slate-200 dark:md:border-slate-800 relative shadow-inner">
                <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-emerald-500" />
                      Consolidation Groups
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Review and approve groups to combine historical records</p>
                  </div>
                  <button
                    onClick={handleApplyConsolidation}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-md flex items-center gap-1 transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Approve & Apply
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {consolidationGroups.map((group, groupIdx) => {
                    const edits = groupEdits[groupIdx] || {
                      recommendedClinicalName: '',
                      recommendedUniqueKey: '',
                      masterKey: '',
                      excludedKeys: {}
                    };

                    const masterBio = group.biomarkers?.find((b: any) => b.key === edits.masterKey) || group.biomarkers?.[0];

                    return (
                      <div key={groupIdx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Recommended Name</label>
                            <input
                              type="text"
                              className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.recommendedClinicalName}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: {
                                    ...edits,
                                    recommendedClinicalName: e.target.value
                                  }
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Key</label>
                            <input
                              type="text"
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.recommendedUniqueKey}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: {
                                    ...edits,
                                    recommendedUniqueKey: e.target.value
                                  }
                                });
                              }}
                            />
                          </div>
                        </div>

                        <div className="overflow-x-auto border border-slate-100 dark:border-slate-800/50 rounded-lg">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800/50">
                                <th className="py-2 px-3 text-center w-12">Combine</th>
                                <th className="py-2 px-3 text-center w-12">Master</th>
                                <th className="py-2 px-3">Key / Name</th>
                                <th className="py-2 px-3">Grouping</th>
                                <th className="py-2 px-3">Unit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.biomarkers?.map((b: any, bIdx: number) => {
                                const isExcluded = !!edits.excludedKeys[b.key];
                                const isMaster = edits.masterKey === b.key;

                                return (
                                  <tr 
                                    key={bIdx} 
                                    className={\`border-b border-slate-100 dark:border-slate-800/30 text-xs \${isExcluded ? 'opacity-40 bg-slate-50/50 dark:bg-slate-950/20' : ''} \${isMaster ? 'bg-violet-50/30 dark:bg-violet-900/10' : ''}\`}
                                  >
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={!isExcluded}
                                        disabled={isMaster}
                                        className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                        onChange={(e) => {
                                          const newExcluded = { ...edits.excludedKeys };
                                          if (e.target.checked) {
                                            delete newExcluded[b.key];
                                          } else {
                                            newExcluded[b.key] = true;
                                          }
                                          setGroupEdits({
                                            ...groupEdits,
                                            [groupIdx]: {
                                              ...edits,
                                              excludedKeys: newExcluded
                                            }
                                          });
                                        }}
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="radio"
                                        name={\`group_master_\${groupIdx}\`}
                                        checked={isMaster}
                                        disabled={isExcluded}
                                        className="w-3.5 h-3.5 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                        onChange={() => {
                                          setGroupEdits({
                                            ...groupEdits,
                                            [groupIdx]: {
                                              ...edits,
                                              masterKey: b.key
                                            }
                                          });
                                        }}
                                      />
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-medium text-slate-800 dark:text-slate-200">{b.name}</div>
                                      <div className="font-mono text-[10px] text-slate-400 mt-0.5">{b.key}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{b.medicalGrouping || '-'}</td>
                                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{b.unit || '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                  <div className="mt-8 bg-slate-900 rounded-xl overflow-hidden shadow-inner">
                    <div className="p-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-slate-400 text-[10px] font-mono">
                      <span className="flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5" /> RAW YAML</span>
                    </div>
                    <div className="p-4 text-slate-300 font-mono text-[11px] whitespace-pre-wrap select-all">
                      {consolidationYaml}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : isChatMode ? (`;

code = code.replace(regexUI, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
