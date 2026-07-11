const fs = require('fs');
const content = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const targetStr = `{(() => {
                const chunks: typeof problematicBiomarkers[] = [];
                for (let i = 0; i < problematicBiomarkers.length; i += 2) {
                  chunks.push(problematicBiomarkers.slice(i, i + 2));
                }
                return chunks.map((chunk, chunkIdx) => {
                  const expandedInChunk = chunk.find(b => expandedKey === b.key);
                  return (
                    <div key={chunkIdx} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">`;

const replacement = `{(() => {
                const groups: Record<string, typeof problematicBiomarkers> = {};
                problematicBiomarkers.forEach(b => {
                  const meta = getBiomarkerMetadata(b.key, profile.customBiomarkers?.[b.key] || b.def);
                  const cat = (meta.riskCategories && meta.riskCategories.length > 0) ? meta.riskCategories[0] : 'Uncategorized';
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(b);
                });

                return Object.entries(groups).map(([category, items]) => {
                  const chunks: typeof problematicBiomarkers[] = [];
                  for (let i = 0; i < items.length; i += 2) {
                    chunks.push(items.slice(i, i + 2));
                  }
                  
                  return (
                    <div key={category} className="space-y-4 mb-6 last:mb-0">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 border-b border-slate-100 dark:border-slate-800 pb-2">{category}</h4>
                      <div className="space-y-4">
                        {chunks.map((chunk, chunkIdx) => {
                          const expandedInChunk = chunk.find(b => expandedKey === b.key);
                          return (
                            <div key={chunkIdx} className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">`;

const newContent = content.replace(targetStr, replacement);

const targetStr2 = `                              </div>
                            </div>
                          </div>
                          <BiomarkerExpandedSection
                            biomarkerKey={expandedInChunk.key}
                            status={expandedInChunk.status}
                            profile={profile}
                            value={expandedInChunk.value}
                          />
                        </div>
                      )}
                    </div>
                  );
                });
              })()}`;

const replacement2 = `                              </div>
                            </div>
                          </div>
                          <BiomarkerExpandedSection
                            biomarkerKey={expandedInChunk.key}
                            status={expandedInChunk.status}
                            profile={profile}
                            value={expandedInChunk.value}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                </div>
                );
                });
              })()}`;

fs.writeFileSync('src/components/HomeTab.tsx', newContent.replace(targetStr2, replacement2));
console.log('replaced');
