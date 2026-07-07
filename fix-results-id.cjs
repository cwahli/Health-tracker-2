const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex1 = /      if \(result\.comparisonResults && Array\.isArray\(result\.comparisonResults\) && result\.comparisonResults\.length > 0\) \{\n        setAccuracyComparisonResults\(result\.comparisonResults\);\n        const initialSelectedFields: any = \{\};\n        result\.comparisonResults\.forEach\(\(item: any\) => \{\n          initialSelectedFields\[item\.key\] = \{/g;

const newText1 = `      if (result.comparisonResults && Array.isArray(result.comparisonResults) && result.comparisonResults.length > 0) {
        const resultsWithId = result.comparisonResults.map((res: any, idx: number) => ({
          ...res,
          id: \`\${res.key}_\${idx}\`
        }));
        setAccuracyComparisonResults(resultsWithId);
        const initialSelectedFields: any = {};
        resultsWithId.forEach((item: any) => {
          initialSelectedFields[item.id] = {`;

code = code.replace(regex1, newText1);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
