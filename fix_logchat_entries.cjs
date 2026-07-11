const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const target = `                                      filteredEntries = filteredEntries.map((entry: any) => {
                                        const newBiomarkers = { ...(entry.biomarkers || {}) };
                                        unselectedKeys.forEach(k => delete newBiomarkers[k]);
                                        const newTests = (entry.tests || []).filter((t: any) => !unselectedKeys.includes(t.key));
                                        return { ...entry, biomarkers: newBiomarkers, tests: newTests };
                                      }).filter((entry: any) => Object.keys(entry.biomarkers).length > 0);`;

const replace = `                                      filteredEntries = filteredEntries.map((entry: any) => {
                                        const newBiomarkers = { ...(entry.biomarkers || {}) };
                                        unselectedKeys.forEach(k => delete newBiomarkers[k]);
                                        const newTests = (entry.tests || []).filter((t: any) => !unselectedKeys.includes(t.key));
                                        newTests.forEach((t: any) => {
                                          newBiomarkers[t.key] = t.valueNumeric !== null && t.valueNumeric !== undefined ? t.valueNumeric : t.valueString;
                                        });
                                        return { ...entry, biomarkers: newBiomarkers, tests: newTests };
                                      }).filter((entry: any) => Object.keys(entry.biomarkers).length > 0);`;

if (code.includes(target)) {
  code = code.split(target).join(replace);
  fs.writeFileSync('src/components/LogChat.tsx', code);
  console.log("Updated LogChat.tsx filtering successfully.");
} else {
  console.log("Targets not found in LogChat.tsx!");
}
