const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /                <div className="p-5 space-y-5">\n                  \{accuracyComparisonResults\.map\(\(item\) => \{\n                    const selects = accuracySelectedFields\[item\.id\] \|\| \{/g;

const newText = `                <div className="p-5 space-y-5">
                  {Object.entries(accuracyComparisonResults.reduce((acc: any, curr: any) => {
                    if (!acc[curr.key]) acc[curr.key] = [];
                    acc[curr.key].push(curr);
                    return acc;
                  }, {})).map(([bKey, items]: [string, any]) => (
                    <div key={bKey} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-900">
                      <div className="p-3 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                        <div className="flex flex-col text-left">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{items[0]?.name?.current !== 'N/A' ? items[0]?.name?.current : bKey}</span>
                          <span className="text-[10px] text-slate-500 font-mono">key: {bKey}</span>
                        </div>
                        <span className="px-2 py-1 bg-white dark:bg-slate-900 rounded-md text-[10px] font-bold text-slate-500 shadow-sm border border-slate-200 dark:border-slate-700">
                          {items.length} Log(s)
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                      {items.map((item: any, idx: number) => {
                        const selects = accuracySelectedFields[item.id] || {`;

code = code.replace(regex, newText);

const endRegex = /                                  <\/tbody>\n                                <\/table>\n                              <\/div>\n                            <\/div>\n                          <\/div>\n                        <\/div>\n                      <\/div>\n                    \);\n                  \}\)\}\n                <\/div>/g;

const newEnd = `                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                  </div>
                  ))}
                </div>`;

code = code.replace(endRegex, newEnd);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
