const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldRegex = /      allKnownKeys\.forEach\(\(key: string\) => \{\n        const matchingLog = sortedHistory\.find\(h => h\.biomarkers && h\.biomarkers\[key\] !== undefined\);\n        if \(matchingLog\) \{\n          const testDetail = matchingLog\.tests\?\.find\(t => t\.key === key\);\n          latestValues\[key\] = \{\n            value: matchingLog\.biomarkers\[key\],\n            date: matchingLog\.date,\n            note: testDetail\?\.doctorComment \|\| matchingLog\.note \|\| ''\n          \};\n        \}\n      \}\);/g;

const newText = `      allKnownKeys.forEach((key: string) => {
        const matchingLogs = sortedHistory.filter(h => h.biomarkers && h.biomarkers[key] !== undefined);
        if (matchingLogs.length > 0) {
          latestValues[key] = matchingLogs.map(matchingLog => {
            const testDetail = matchingLog.tests?.find(t => t.key === key);
            return {
              value: matchingLog.biomarkers[key],
              date: matchingLog.date,
              note: testDetail?.doctorComment || matchingLog.note || '',
              logId: matchingLog.id
            };
          });
        }
      });`;

code = code.replace(oldRegex, newText);

const stateRegex = /      const currentState = \{\n        customBiomarkers: filteredCustomBiomarkers,\n        latestHistoryValues: latestValues\n      \};/g;

const newSate = `      const currentState = {
        customBiomarkers: filteredCustomBiomarkers,
        historyValues: latestValues
      };`;

code = code.replace(stateRegex, newSate);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
