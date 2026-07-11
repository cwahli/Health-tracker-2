const fs = require('fs');

const file = 'src/components/InsightsTab.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = `className="w-16 text-[10px] font-bold bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-text"
                                />
                              </div>`;

const replacement = `className="w-16 text-[10px] font-bold bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-text"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm("This will clear all processed batches in Data Cleaning and Data Review, and force a full re-chunking. Proceed?")) {
                                      setApprovedBatches({});
                                      setBatchAnalysisResults({});
                                      setApprovedAgent1Batches({});
                                      setAgent1BatchResults({});
                                      localStorage.removeItem('approved_data_review_batches');
                                      localStorage.removeItem('batch_analysis_results');
                                      localStorage.removeItem('approved_agent1_batches');
                                      localStorage.removeItem('agent1_batch_results');
                                      if (onChangeBatchSize) onChangeBatchSize(parseInt(batchSizeInput) || 20);
                                    }
                                  }}
                                  title="Reset all batch progress to force re-chunk"
                                  className="ml-2 px-2 py-1 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[10px] font-bold rounded flex-shrink-0 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                >
                                  Reset Batches
                                </button>
                              </div>`;

content = content.replace(target, replacement);
fs.writeFileSync(file, content);
