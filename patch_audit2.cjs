const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

code = code.replace(
  /const getDef = \(key: string\) => \{\s*return getMergedBiomarkerDef\(key, catalogByKey\.get\(key\.toLowerCase\(\)\), customBiomarkers\[key\], biomarkerHistory \? \(biomarkerHistory\.map\(h => \(\{ unit: h\.biomarkers\?\.\[key\], normalRange: h\.normalRanges\?\.\[key\] \}\)\)\) : undefined\);\s*\};/g,
  `const getDef = (key: string) => {
    return getMergedBiomarkerDef(key, catalogByKey.get(key.toLowerCase()), customBiomarkers[key], biomarkerHistory);
  };`
);

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', code);
