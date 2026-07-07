const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

code = code.replace(/    \}export const BiomarkerRangeBuilder/g, '    };\n\nexport const BiomarkerRangeBuilder');
code = code.replace(/    \}\nexport const BiomarkerRangeBuilder/g, '    };\n\nexport const BiomarkerRangeBuilder');

fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
