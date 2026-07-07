const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldTd = `                                      <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                          {(Array.isArray(parsedRisks) ? parsedRisks : []).map((r: string, i: number) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 rounded text-[10px]">{r}</span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                          {(Array.isArray(parsedConds) ? parsedConds : []).map((c: string, i: number) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded text-[10px]">{c}</span>
                                          ))}
                                        </div>
                                      </td>`;

const newTd = `                                      <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                          {/* Show deleted risk categories */}
                                          {(originalDef?.riskCategories || []).filter((r: string) => !(Array.isArray(parsedRisks) ? parsedRisks : []).includes(r)).map((r: string, i: number) => (
                                            <span key={"del-"+i} className="px-1.5 py-0.5 border border-rose-200 dark:border-rose-900/30 text-slate-400 line-through rounded text-[10px]">{r}</span>
                                          ))}
                                          {(Array.isArray(parsedRisks) ? parsedRisks : []).map((r: string, i: number) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 rounded text-[10px]">{r}</span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                          {/* Show deleted conditions */}
                                          {(originalDef?.potentialMedicalConditions || []).filter((c: string) => !(Array.isArray(parsedConds) ? parsedConds : []).includes(c)).map((c: string, i: number) => (
                                            <span key={"del-"+i} className="px-1.5 py-0.5 border border-indigo-200 dark:border-indigo-900/30 text-slate-400 line-through rounded text-[10px]">{c}</span>
                                          ))}
                                          {(Array.isArray(parsedConds) ? parsedConds : []).map((c: string, i: number) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded text-[10px]">{c}</span>
                                          ))}
                                        </div>
                                      </td>`;

code = code.replace(oldTd, newTd);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched summary");
