const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const tableBodyRegex = /                                    <td className="py-2\.5 px-3">\n                                      <div className="font-medium text-slate-800 dark:text-slate-200">\{b\.name\}<\/div>\n                                      <div className="font-mono text-\[10px\] text-slate-400 mt-0\.5">\{b\.key\}<\/div>\n                                    <\/td>\n                                    <td className="py-2\.5 px-3 text-slate-600 dark:text-slate-400">\{b\.medicalGrouping \|\| '-'\}<\/td>\n                                    <td className="py-2\.5 px-3 font-mono text-slate-600 dark:text-slate-400">\{b\.unit \|\| '-'\}<\/td>\n                                  <\/tr>/g;
code = code.replace(tableBodyRegex, `                                    <td className="py-2.5 px-3">
                                      <div className="font-medium text-slate-800 dark:text-slate-200">{b.name}</div>
                                      <div className="font-mono text-[10px] text-slate-400 mt-0.5">{b.key}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{b.medicalGrouping || '-'}</td>
                                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{b.unit || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[10px] whitespace-pre-wrap">{b.range || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[10px]">{b.description || '-'}</td>
                                    <td className="py-2.5 px-3 font-medium text-slate-600 dark:text-slate-400">
                                      {biomarkerHistory.filter((h: any) => h.biomarkers && h.biomarkers[b.key] !== undefined).length}
                                    </td>
                                  </tr>`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
