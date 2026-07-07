const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

// Replace accuracySelectedFields[item.key] with accuracySelectedFields[item.id]
code = code.replace(/accuracySelectedFields\[item\.key\]/g, "accuracySelectedFields[item.id]");

// Inside handleSendDataAccuracy:
const oldResp = /const data = await response\.json\(\);\n\n      if \(data\.comparisonResults\) \{\n        setAccuracyComparisonResults\(data\.comparisonResults\);\n      \}/;
const newResp = `const data = await response.json();

      if (data.comparisonResults) {
        const resultsWithId = data.comparisonResults.map((res: any, idx: number) => ({
          ...res,
          id: \`\${res.key}_\${idx}\`
        }));
        setAccuracyComparisonResults(resultsWithId);
      }`;
code = code.replace(oldResp, newResp);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
