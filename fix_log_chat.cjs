const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetStr = `                      {/* Key Nutrient Comparison Table */}
                      {msg.agentResult.comparison.comparisonTableMarkdown && (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/30 dark:bg-slate-900/10 mt-2">
                          <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              \uD83D\uDCCA Side-by-Side Comparison Matrix
                            </span>
                          </div>
                          <div className="p-3 text-[11px] overflow-x-auto font-mono text-slate-700 dark:text-slate-300 whitespace-pre leading-relaxed">
                            {msg.agentResult.comparison.comparisonTableMarkdown}
                          </div>
                        </div>
                      )}`;

const insertStr = `                      {/* Key Nutrient Comparison Table */}
                      {(msg.agentResult.comparison.comparisonTableYaml || msg.agentResult.comparison.comparisonTableMarkdown) && (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/30 dark:bg-slate-900/10 mt-2">
                          <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              \uD83D\uDCCA Side-by-Side Comparison Matrix
                            </span>
                          </div>
                          {msg.agentResult.comparison.comparisonTableYaml ? (
                            <div className="p-0 overflow-x-auto">
                              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500">
                                  <tr>
                                    {msg.agentResult.comparison.comparisonTableYaml.columns?.map((col: string, idx: number) => (
                                      <th key={idx} className="px-3 py-2 font-semibold whitespace-nowrap">{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                  {msg.agentResult.comparison.comparisonTableYaml.rows?.map((row: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">{row.nutrient}</td>
                                      <td className="px-3 py-2 whitespace-nowrap">{row.foodA}</td>
                                      <td className="px-3 py-2 whitespace-nowrap">{row.foodB}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-amber-600 dark:text-amber-400 font-medium">{row.target}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-3 text-[11px] overflow-x-auto font-mono text-slate-700 dark:text-slate-300 whitespace-pre leading-relaxed">
                              {msg.agentResult.comparison.comparisonTableMarkdown}
                            </div>
                          )}
                        </div>
                      )}`;

if (code.includes(targetStr)) {
  code = code.replace(targetStr, insertStr);
  fs.writeFileSync('src/components/LogChat.tsx', code);
  console.log("Fixed LogChat.tsx");
} else {
  console.log("Could not find target string in LogChat.tsx");
}
