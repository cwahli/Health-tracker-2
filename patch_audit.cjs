const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

if (!code.includes('getMergedBiomarkerDef')) {
  code = code.replace(
    /import \{ biomarkerDefinitions,/g,
    `import { biomarkerDefinitions, getMergedBiomarkerDef,`
  );
}

// Replace the two occurrences of getDef definitions
// First occurrence around line 448
code = code.replace(
  /const getDef = \(key: string\) => \{\s*return customBiomarkers\[key\] \|\| catalogByKey\.get\(key\.toLowerCase\(\)\) \|\| biomarkerDefinitions\.find\(\(b: any\) => b\.key === key\) \|\| \{\};\s*\};/g,
  `const getDef = (key: string) => {
    return getMergedBiomarkerDef(key, catalogByKey.get(key.toLowerCase()), customBiomarkers[key], biomarkerHistory ? (biomarkerHistory.map(h => ({ unit: h.biomarkers?.[key], normalRange: h.normalRanges?.[key] }))) : undefined);
  };`
);

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', code);
