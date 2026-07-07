const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldHeader = `              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 font-sans tracking-tight">
                {isChatMode ? "Route Agent Chat" : isAgentMode ? "Clinical Unit Standardization Agent" : isBatchPasteMode ? "Batch Consolidation" : "Biomarker Dictionary"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isChatMode 
                  ? \`Discussing standard mappings for \${selectedKeys.length} selected biomarkers\` 
                  : isAgentMode
                    ? \`Standardize units and convert ranges for \${selectedKeys.length} selected biomarkers\`
                    : isBatchPasteMode 
                      ? "Paste a JSON configuration file to automatically map and aggregate history logs"
                      : "Standardize, route, or batch-consolidate your custom biomarkers"}
              </p>`;

const newHeader = `              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 font-sans tracking-tight">
                {isChatMode ? "Route Agent Chat" : isAgentMode ? (isMedicalCategorisationMode ? "Clinical Categorisation Agent" : "Clinical Unit Standardization Agent") : isBatchPasteMode ? "Batch Consolidation" : "Biomarker Dictionary"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isChatMode 
                  ? \`Discussing standard mappings for \${selectedKeys.length} selected biomarkers\` 
                  : isAgentMode
                    ? (isMedicalCategorisationMode ? \`Determine medical groupings and risk categories for \${selectedKeys.length} selected biomarkers\` : \`Standardize units and convert ranges for \${selectedKeys.length} selected biomarkers\`)
                    : isBatchPasteMode 
                      ? "Paste a JSON configuration file to automatically map and aggregate history logs"
                      : "Standardize, route, or batch-consolidate your custom biomarkers"}
              </p>`;

code = code.replace(oldHeader, newHeader);

const oldControls = `            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Metric Selection controls */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-violet-500" />
                    Step 1: Choose Target Metric System
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Select whether the standardization agent should target the International System of Units (SI/Metric) or US Customary units.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setTargetMetric('si')}
                    className={\`p-4 rounded-xl border text-left transition-all \${
                      targetMetric === 'si'
                        ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }\`}
                  >
                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                      <span>SI System (Metric)</span>
                      {targetMetric === 'si' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Uses standard metric units (e.g., mmol/L for glucose, g/L for protein, pmol/L for hormones). Standard in global clinical research.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetMetric('us')}
                    className={\`p-4 rounded-xl border text-left transition-all \${
                      targetMetric === 'us'
                        ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }\`}
                  >
                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                      <span>US Customary System</span>
                      {targetMetric === 'us' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Uses standard United States clinical units (e.g., mg/dL for glucose, g/dL for protein, pg/mL for hormones).
                    </p>
                  </button>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRunStandardizationAgent}
                    disabled={agentLoading || selectedKeys.length === 0}
                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10 disabled:opacity-50"
                  >
                    {agentLoading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        Agent Working in YAML to Add Standardized Units...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-4 h-4" />
                        Run Clinical Unit Standardization Agent (YAML)
                      </>
                    )}
                  </button>
                </div>
              </div>`;

const newControls = `            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Metric Selection controls */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                {!isMedicalCategorisationMode && (
                  <>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-violet-500" />
                        Step 1: Choose Target Metric System
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Select whether the standardization agent should target the International System of Units (SI/Metric) or US Customary units.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setTargetMetric('si')}
                        className={\`p-4 rounded-xl border text-left transition-all \${
                          targetMetric === 'si'
                            ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }\`}
                      >
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                          <span>SI System (Metric)</span>
                          {targetMetric === 'si' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Uses standard metric units (e.g., mmol/L for glucose, g/L for protein, pmol/L for hormones). Standard in global clinical research.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTargetMetric('us')}
                        className={\`p-4 rounded-xl border text-left transition-all \${
                          targetMetric === 'us'
                            ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }\`}
                      >
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                          <span>US Customary System</span>
                          {targetMetric === 'us' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Uses standard United States clinical units (e.g., mg/dL for glucose, g/dL for protein, pg/mL for hormones).
                        </p>
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRunStandardizationAgent}
                    disabled={agentLoading || selectedKeys.length === 0}
                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10 disabled:opacity-50"
                  >
                    {agentLoading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        {isMedicalCategorisationMode ? 'Agent Working in YAML to Add Categorisations...' : 'Agent Working in YAML to Add Standardized Units...'}
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-4 h-4" />
                        {isMedicalCategorisationMode ? 'Run Clinical Categorisation Agent (YAML)' : 'Run Clinical Unit Standardization Agent (YAML)'}
                      </>
                    )}
                  </button>
                </div>
              </div>`;

code = code.replace(oldControls, newControls);

const oldLoadingText = `                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Standardizing Biomarker Definitions...</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                      The clinical AI agent is parsing the selected biomarkers, researching reference units for {targetMetric.toUpperCase()}, and outputting clean, validated YAML configuration objects with suggested ranges.
                    </p>
                  </div>`;

const newLoadingText = `                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {isMedicalCategorisationMode ? 'Categorising Biomarkers...' : 'Standardizing Biomarker Definitions...'}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                      {isMedicalCategorisationMode
                        ? 'The clinical AI agent is analyzing the biomarkers to assign medical groupings and risk categories, outputting validated YAML configuration objects.'
                        : \`The clinical AI agent is parsing the selected biomarkers, researching reference units for \${targetMetric.toUpperCase()}, and outputting clean, validated YAML configuration objects with suggested ranges.\`}
                    </p>
                  </div>`;

code = code.replace(oldLoadingText, newLoadingText);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched modal agent state");
