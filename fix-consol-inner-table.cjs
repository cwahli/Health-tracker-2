const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const tableHeadRegex = /                                <th className="py-2 px-3">Key \/ Name<\/th>\n                                <th className="py-2 px-3">Grouping<\/th>\n                                <th className="py-2 px-3">Unit<\/th>/g;
code = code.replace(tableHeadRegex, `                                <th className="py-2 px-3">Key / Name</th>
                                <th className="py-2 px-3">Grouping</th>
                                <th className="py-2 px-3">Unit</th>
                                <th className="py-2 px-3 min-w-[80px]">Range</th>
                                <th className="py-2 px-3 min-w-[150px]">Description</th>
                                <th className="py-2 px-3">Logs</th>`);

const tableBodyRegex = /                                    <td className="py-2\.5 px-3">\n                                      <div className="font-bold text-slate-800 dark:text-slate-200">\{b\.name\}<\/div>\n                                      <div className="font-mono text-\[10px\] text-slate-500">\{b\.key\}<\/div>\n                                    <\/td>\n                                    <td className="py-2\.5 px-3 text-slate-600 dark:text-slate-400">\{b\.medicalGrouping\}<\/td>\n                                    <td className="py-2\.5 px-3 text-slate-600 dark:text-slate-400 font-medium">\{b\.unit\}<\/td>\n                                  <\/tr>/g;
code = code.replace(tableBodyRegex, `                                    <td className="py-2.5 px-3">
                                      <div className="font-bold text-slate-800 dark:text-slate-200">{b.name}</div>
                                      <div className="font-mono text-[10px] text-slate-500">{b.key}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{b.medicalGrouping || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-medium">{b.unit || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px] whitespace-pre-wrap">{b.range || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[10px] line-clamp-2" title={b.description}>{b.description || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-medium">
                                      {biomarkerHistory.filter(h => h.biomarkers && h.biomarkers[b.key] !== undefined).length}
                                    </td>
                                  </tr>`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
