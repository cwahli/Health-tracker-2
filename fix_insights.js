const fs = require('fs');
let code = fs.readFileSync('src/components/InsightsTab.tsx', 'utf8');

// Replace step 1
code = code.replace(
  `                                                          parsedRows.forEach((parsed: any, idx: number) => {`,
  `                                                          parsedRows.forEach((parsed: any, idx: number) => {
                                                            if (parsed.originalName) {
                                                              const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                                                              const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                                                              if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                                                                bestParsedIdx = idx;
                                                                return;
                                                              }
                                                            }`
);

code = code.replace(
  `                                                            const stdKey = (parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');`,
  `                                                            const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                                                            const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();`
);

code = code.replace(
  `                                                            if (stdKey && rawKey !== stdKey) {
                                                              // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey`,
  `                                                            if (action.includes('delete')) {
                                                              currentHistory.forEach((log: any) => {
                                                                if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                                                                  delete log.biomarkers[rawKey];
                                                                }
                                                              });
                                                              delete updatedCustoms[rawKey];
                                                            } else if (stdKey && rawKey !== stdKey) {
                                                              // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey`
);

// Replace step 2: remove value inserting, and update key mapping
code = code.replace(
  `                                                        const key = row.key || (row.name || row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                                                        if (!key) return;
                                                        const name = row.name || row.biomarker || 'Unknown';`,
  `                                                        const key = (row.standardizedName || row.key || row.name || row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                                                        if (!key) return;
                                                        const name = row.standardizedName || row.name || row.biomarker || 'Unknown';`
);

code = code.replace(
  /                                                        \/\/ Save value & date to biomarkerHistory[\s\S]*?(?=                                                      }\);)/,
  `                                                        // Not overriding or duplicating values in history here because we simply map keys for data cleaning.\n`
);

fs.writeFileSync('src/components/InsightsTab.tsx', code);
