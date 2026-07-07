const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /<td className="py-2\.5 px-3 text-slate-600 dark:text-slate-400">\{b\.medicalGrouping \|\| '-'}<\/td>/;

const newCode = `<td className="py-2.5 px-3">
                                      <div className="text-slate-600 dark:text-slate-400 mb-1">{b.medicalGrouping || '-'}</div>
                                      {(() => {
                                        const origDef = profile.customBiomarkers?.[b.key] || biomarkerDefinitions.find((def: any) => def.key === b.key) || {};
                                        const rTags = origDef.riskCategories || [];
                                        const cTags = origDef.potentialMedicalConditions || [];
                                        if (rTags.length === 0 && cTags.length === 0) return null;
                                        return (
                                          <div className="flex flex-wrap gap-1">
                                            {rTags.map((r: string, i: number) => (
                                              <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 rounded-full border border-rose-100 dark:border-rose-900/30 whitespace-nowrap">
                                                {r}
                                              </span>
                                            ))}
                                            {cTags.map((c: string, i: number) => (
                                              <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-full border border-amber-100 dark:border-amber-900/30 whitespace-nowrap">
                                                {c}
                                              </span>
                                            ))}
                                          </div>
                                        );
                                      })()}
                                    </td>`;

if (code.match(regex)) {
  code = code.replace(regex, newCode);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log('Fixed tags');
} else {
  console.log('Regex did not match');
}
