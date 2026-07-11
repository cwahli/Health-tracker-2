const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const matchBlock = `                    if (cleanRawKey === cleanParsedKey) {
                      score += 100;
                    } else if (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey)) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore) {
                      bestScore = score;
                      bestParsedIdx = idx;
                    }
                  });

                  if (bestParsedIdx !== -1) {
                    const parsedRow = parsedRows[bestParsedIdx];
                    const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();
                    
                    if (action.includes('delete')) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          delete log.biomarkers[rawKey];
                        }
                      });
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    } else if (stdKey && rawKey !== stdKey) {
                      // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          const valueToMigrate = log.biomarkers[rawKey];
                          log.biomarkers[stdKey] = valueToMigrate;
                          delete log.biomarkers[rawKey];
                        }
                      });

                      // Delete from customBiomarkers list
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    }
                  } else {
                    // Completely unmapped/deleted raw item: delete from all historical logs and custom definitions
                    hHistory.forEach((log: any) => {
                      if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                        delete log.biomarkers[rawKey];
                      }
                    });
                    delete updatedCustoms[rawKey];
                    deletedKeysToSync.push(rawKey);
                  }`;

const matchRepl = `                    if (cleanRawKey === cleanParsedKey) {
                      score += 100;
                    } else if (cleanParsedKey.length >= 4 && cleanRawKey.length >= 4 && (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey))) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore && score >= 40) {
                      bestScore = score;
                      bestParsedIdx = idx;
                    }
                  });

                  if (bestParsedIdx !== -1) {
                    const parsedRow = parsedRows[bestParsedIdx];
                    const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();
                    
                    if (action.includes('delete')) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          delete log.biomarkers[rawKey];
                        }
                      });
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    } else if (stdKey && rawKey !== stdKey) {
                      // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          const valueToMigrate = log.biomarkers[rawKey];
                          log.biomarkers[stdKey] = valueToMigrate;
                          delete log.biomarkers[rawKey];
                        }
                      });

                      // Delete from customBiomarkers list
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    }
                  } else {
                    // No confident match found \u2014 leave this key untouched (FIX-7B).
                    // Do NOT delete data that wasn't explicitly handled in this batch's output.
                    console.log(\`[Agent Approval] No confident match for raw key "\${rawKey}" \u2014 skipping deletion.\`);
                  }`;

code = code.replace(matchBlock, matchRepl);
fs.writeFileSync('src/App.tsx', code);
